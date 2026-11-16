// Roland SysEx for the Katana Gen 3 (protocol-notes 2.2, 2.3).
//
//   F0 41 <dev> 01 05 07 <cmd> <addr x4> <data ...> <checksum> F7
//
// RQ1 (11) carries a 4-byte size instead of data, DT1 (12) carries data. Addresses and sizes are linear inside
// the app and converted here.

import { fromLinear, toLinear, type Address } from './address';

export const ROLAND_ID = 0x41;
export const MODEL_ID = [0x01, 0x05, 0x07] as const;
export const CMD_RQ1 = 0x11;
export const CMD_DT1 = 0x12;
/** Device ID that every device accepts; incoming messages with it are accepted too (like BTS). */
export const BROADCAST_DEVICE_ID = 0x7f;
/** Model code in byte 10 of the identity reply. */
export const MODEL_CODE_KATANA_100 = 0x06;

export const IDENTITY_REQUEST: readonly number[] = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];

/** Bytes of one complete MIDI message as they go on the wire. */
export type MidiBytes = readonly number[];

export function checksum(bytes: readonly number[]): number {
  let sum = 0;
  for (const b of bytes) sum += b;
  return (128 - (sum % 128)) % 128;
}

function rolandMessage(deviceId: number, cmd: number, address: Address, body: readonly number[]): number[] {
  const payload = [...fromLinear(address), ...body];
  for (const b of [deviceId, ...payload]) {
    if (!Number.isInteger(b) || b < 0 || b > 0x7f) throw new RangeError(`Not a 7-bit byte: ${b}`);
  }
  return [0xf0, ROLAND_ID, deviceId, ...MODEL_ID, cmd, ...payload, checksum(payload), 0xf7];
}

/** Read request. `size` is a linear byte count (converted to 7-bit digits, which matters above 127). */
export function buildRq1(deviceId: number, address: Address, size: number): number[] {
  if (size < 1) throw new RangeError(`RQ1 size must be at least 1, got ${size}`);
  return rolandMessage(deviceId, CMD_RQ1, address, fromLinear(size));
}

/** Write (or report, when it comes from the amp). */
export function buildDt1(deviceId: number, address: Address, data: readonly number[]): number[] {
  if (data.length === 0) throw new RangeError('DT1 needs data');
  return rolandMessage(deviceId, CMD_DT1, address, data);
}

export interface IdentityReply {
  readonly type: 'identity';
  readonly deviceId: number;
  readonly manufacturerId: number;
  readonly modelCode: number;
  readonly bytes: MidiBytes;
}

export interface Dt1Message {
  readonly type: 'dt1';
  readonly deviceId: number;
  readonly address: Address;
  readonly data: readonly number[];
  readonly checksumOk: boolean;
  readonly bytes: MidiBytes;
}

export interface Rq1Message {
  readonly type: 'rq1';
  readonly deviceId: number;
  readonly address: Address;
  readonly size: number;
  readonly checksumOk: boolean;
  readonly bytes: MidiBytes;
}

export interface OtherMessage {
  /** `roland-other`: our model, unknown command; `sysex-other`: any other SysEx; `short`: not SysEx. */
  readonly type: 'roland-other' | 'sysex-other' | 'short';
  readonly bytes: MidiBytes;
}

export type ParsedMessage = IdentityReply | Dt1Message | Rq1Message | OtherMessage;

/** Classifies one complete MIDI message. Never throws. */
export function parseMessage(bytes: MidiBytes): ParsedMessage {
  const d = bytes;
  if (d.length < 2 || d[0] !== 0xf0 || d[d.length - 1] !== 0xf7) return { type: 'short', bytes };

  // Identity reply: F0 7E <dev> 06 02 <manufacturer> ... F7
  if (d[1] === 0x7e && d[3] === 0x06 && d[4] === 0x02 && d.length >= 15) {
    return {
      type: 'identity',
      deviceId: d[2] ?? 0,
      manufacturerId: d[5] ?? 0,
      modelCode: d[10] ?? 0,
      bytes,
    };
  }

  const isOurModel = d[1] === ROLAND_ID && MODEL_ID.every((m, i) => d[3 + i] === m);
  if (!isOurModel) return { type: 'sysex-other', bytes };

  const cmd = d[6];
  // Header (7) + address (4) + at least one data byte + checksum + F7 = 14.
  if ((cmd !== CMD_DT1 && cmd !== CMD_RQ1) || d.length < 14) return { type: 'roland-other', bytes };

  const body = d.slice(7, d.length - 2);
  if (body.some((b) => b > 0x7f)) return { type: 'roland-other', bytes };
  const addressBytes = body.slice(0, 4);
  const data = body.slice(4);
  const checksumOk = checksum(body) === d[d.length - 2];
  const deviceId = d[2] ?? 0;
  const address = toLinear(addressBytes);

  if (cmd === CMD_DT1) return { type: 'dt1', deviceId, address, data, checksumOk, bytes };
  if (data.length !== 4) return { type: 'roland-other', bytes };
  return { type: 'rq1', deviceId, address, size: toLinear(data), checksumOk, bytes };
}

/** Incoming Roland messages are accepted with the learned device ID and with 7F (PLAN 4.3). */
export function acceptsDeviceId(learned: number, incoming: number): boolean {
  return incoming === learned || incoming === BROADCAST_DEVICE_ID;
}

export function hex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export function parseHex(text: string): number[] {
  return text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((p) => {
      if (!/^[0-9a-fA-F]{1,2}$/.test(p)) throw new SyntaxError(`Not a hex byte: "${p}"`);
      return parseInt(p, 16);
    });
}
