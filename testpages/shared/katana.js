// Shared protocol helpers for the Phase 0 test pages (plain ES module, no dependencies).
// Covers Roland SysEx for the Katana Gen 3 and USB-MIDI packet framing.
// The real app re-implements this in TypeScript under src/protocol and src/midi (Phase 0b).

export const USB_IDS = Object.freeze({ vendorId: 0x0582, productId: 0x02f0 });

export const ROLAND_ID = 0x41;
export const MODEL_ID = Object.freeze([0x01, 0x05, 0x07]);
export const CMD_RQ1 = 0x11;
export const CMD_DT1 = 0x12;
export const BROADCAST_DEVICE_ID = 0x7f;
export const MODEL_CODE_KATANA_100 = 0x06;

export const IDENTITY_REQUEST = Object.freeze([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);

// Addresses in Roland 7-bit notation, exactly as they go on the wire.
export const ADDR = Object.freeze({
  patchNumber: [0x00, 0x00, 0x00, 0x00], // current patch index 0-9
  system: [0x10, 0x00, 0x00, 0x00],
  currentPatch: [0x20, 0x00, 0x00, 0x00],
  storedPatchBase: [0x20, 0x10, 0x00, 0x00], // PATCH(1) = index 0 (Panel)
  editorLevel: [0x7f, 0x00, 0x00, 0x00],
  editorMode: [0x7f, 0x00, 0x00, 0x01],
  patchSelect: [0x7f, 0x00, 0x01, 0x00],
  patchWrite: [0x7f, 0x00, 0x01, 0x04],
});

// Sizes in Roland 7-bit notation.
export const SIZE = Object.freeze({
  patch: [0x00, 0x02, 0x00, 0x00],
  allStoredPatches: [0x01, 0x20, 0x00, 0x00],
  storedPatchStride: [0x00, 0x10, 0x00, 0x00],
});

// Offsets inside a patch (linear).
export const PATCH_OFFSET = Object.freeze({
  name: toLinear([0x00, 0x00, 0x00, 0x00]), // 16 ASCII characters
  ampGain: toLinear([0x00, 0x00, 0x06, 0x00]),
  ampVolume: toLinear([0x00, 0x00, 0x06, 0x01]),
  nsSwitch: toLinear([0x00, 0x00, 0x58, 0x00]),
  nsThreshold: toLinear([0x00, 0x00, 0x58, 0x01]),
  nsRelease: toLinear([0x00, 0x00, 0x58, 0x02]),
});
export const PATCH_NAME_LENGTH = 16;

export const PATCH_SLOT_NAMES = Object.freeze([
  'Panel', 'A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'PREVIEW',
]);

// ---- Hex helpers ----

export function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export function parseHex(text) {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  return parts.map((p) => {
    if (!/^[0-9a-fA-F]{1,2}$/.test(p)) throw new Error(`Not a hex byte: "${p}"`);
    return parseInt(p, 16);
  });
}

// ---- Address math ----
// Addresses and sizes are four 7-bit digits. Never add them byte-wise; convert to linear first.

export function toLinear(bytes4) {
  if (bytes4.length !== 4) throw new Error('Address/size needs 4 bytes');
  let n = 0;
  for (const b of bytes4) {
    if (!Number.isInteger(b) || b < 0 || b > 0x7f) throw new Error(`Not a 7-bit byte: ${b}`);
    n = n * 128 + b;
  }
  return n;
}

export function fromLinear(n) {
  if (!Number.isInteger(n) || n < 0 || n >= 128 ** 4) throw new Error(`Out of range: ${n}`);
  return [Math.floor(n / 128 ** 3) % 128, Math.floor(n / 128 ** 2) % 128, Math.floor(n / 128) % 128, n % 128];
}

export function addOffset(addr, linearOffset) {
  return fromLinear(toLinear(addr) + linearOffset);
}

// Address of the stored patch for patch index 0-9 (0 = Panel, 1-4 = A1-A4, 5-8 = B1-B4, 9 = PREVIEW).
export function storedPatchAddress(index) {
  if (!Number.isInteger(index) || index < 0 || index > 9) throw new Error(`Bad patch index: ${index}`);
  return addOffset(ADDR.storedPatchBase, index * toLinear(SIZE.storedPatchStride));
}

// ---- Roland SysEx ----

export function checksum(bytes) {
  let sum = 0;
  for (const b of bytes) sum += b;
  return (128 - (sum % 128)) % 128;
}

function rolandMessage(deviceId, cmd, addr, body) {
  const payload = [...addr, ...body];
  for (const b of payload) {
    if (!Number.isInteger(b) || b < 0 || b > 0x7f) throw new Error(`Not a 7-bit byte: ${b}`);
  }
  return [0xf0, ROLAND_ID, deviceId, ...MODEL_ID, cmd, ...payload, checksum(payload), 0xf7];
}

// size: linear number of bytes, or 4 bytes in 7-bit notation.
export function buildRq1(deviceId, addr, size) {
  const sizeBytes = typeof size === 'number' ? fromLinear(size) : size;
  if (sizeBytes.length !== 4) throw new Error('Size needs 4 bytes');
  return rolandMessage(deviceId, CMD_RQ1, addr, sizeBytes);
}

export function buildDt1(deviceId, addr, data) {
  if (data.length === 0) throw new Error('DT1 needs data');
  return rolandMessage(deviceId, CMD_DT1, addr, data);
}

// Classifies one complete MIDI message (F0 ... F7 for SysEx).
// Returns { type: 'identity' | 'dt1' | 'rq1' | 'roland-other' | 'sysex-other' | 'short', ... }.
export function parseMessage(bytes) {
  const d = Array.from(bytes);
  if (d[0] !== 0xf0 || d[d.length - 1] !== 0xf7) return { type: 'short', bytes: d };

  if (d[1] === 0x7e && d[3] === 0x06 && d[4] === 0x02 && d.length >= 15) {
    return {
      type: 'identity',
      deviceId: d[2],
      manufacturerId: d[5],
      family: d.slice(6, 8),
      modelCode: d[10],
      tail: d.slice(8, d.length - 1),
      bytes: d,
    };
  }

  const isOurModel = d[1] === ROLAND_ID && MODEL_ID.every((m, i) => d[3 + i] === m);
  if (!isOurModel) return { type: 'sysex-other', bytes: d };

  const cmd = d[6];
  if ((cmd !== CMD_DT1 && cmd !== CMD_RQ1) || d.length < 14) {
    return { type: 'roland-other', deviceId: d[2], command: cmd, bytes: d };
  }
  const address = d.slice(7, 11);
  const data = d.slice(11, d.length - 2);
  const checksumOk = checksum([...address, ...data]) === d[d.length - 2];
  return {
    type: cmd === CMD_DT1 ? 'dt1' : 'rq1',
    deviceId: d[2],
    address,
    linearAddress: toLinear(address),
    data, // for rq1: the 4 size bytes
    checksumOk,
    bytes: d,
  };
}

// ---- Value encodings ----

export function decodeAscii(data) {
  return String.fromCharCode(...data).trimEnd();
}

// Nibble-encoded value (u2x4, u4x4): most significant nibble first.
export function decodeNibbles(data) {
  let n = 0;
  for (const b of data) n = n * 16 + (b & 0x0f);
  return n;
}

export function encodeNibbles(value, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(Math.floor(value / 16 ** i) % 16);
  return out;
}

// ---- Send pacing (like BTS): 20 ms plus message length / 3.125 ms ----

export function sendIntervalMs(messageLength) {
  return 20 + messageLength / 3.125;
}

// ---- USB-MIDI event packets (4 bytes each) ----

// Wraps one complete SysEx message (F0 ... F7) into USB-MIDI packets.
export function packetizeSysex(sysex, cable = 0) {
  const d = Array.from(sysex);
  if (d[0] !== 0xf0 || d[d.length - 1] !== 0xf7) throw new Error('Not a complete SysEx message');
  if (cable < 0 || cable > 15) throw new Error(`Bad cable number: ${cable}`);
  const out = [];
  for (let i = 0; i < d.length; i += 3) {
    const rest = d.length - i;
    if (rest > 3) out.push((cable << 4) | 0x4, d[i], d[i + 1], d[i + 2]);
    else if (rest === 3) out.push((cable << 4) | 0x7, d[i], d[i + 1], d[i + 2]);
    else if (rest === 2) out.push((cable << 4) | 0x6, d[i], d[i + 1], 0);
    else out.push((cable << 4) | 0x5, d[i], 0, 0);
  }
  return Uint8Array.from(out);
}

// Number of MIDI bytes carried by a packet with the given Code Index Number.
const CIN_LENGTH = [0, 0, 2, 3, 3, 1, 2, 3, 3, 3, 3, 3, 2, 2, 3, 1];

// Stateful parser: feed it raw transfers, get complete MIDI messages back.
// A transfer may hold several packets, and a SysEx message may span transfers.
export class UsbMidiParser {
  constructor() {
    this.leftover = [];
    this.sysex = new Map(); // cable -> bytes collected so far
  }

  reset() {
    this.leftover = [];
    this.sysex.clear();
  }

  // Returns [{ cable, bytes }] for every message completed by this chunk.
  push(chunk) {
    const bytes = this.leftover.concat(Array.from(chunk));
    const usable = bytes.length - (bytes.length % 4);
    this.leftover = bytes.slice(usable);
    const messages = [];

    for (let i = 0; i < usable; i += 4) {
      const cable = bytes[i] >> 4;
      const cin = bytes[i] & 0x0f;
      const payload = bytes.slice(i + 1, i + 1 + CIN_LENGTH[cin]);
      if (payload.length === 0) continue; // padding or reserved

      const isSysexPart = cin === 0x4 || cin === 0x6 || cin === 0x7 || (cin === 0x5 && payload[0] === 0xf7);
      if (isSysexPart || this.sysex.has(cable) && cin === 0x5) {
        const buf = this.sysex.get(cable) ?? [];
        buf.push(...payload);
        if (cin === 0x4) {
          this.sysex.set(cable, buf);
        } else {
          this.sysex.delete(cable);
          messages.push({ cable, bytes: buf });
        }
      } else {
        messages.push({ cable, bytes: payload });
      }
    }
    return messages;
  }
}
