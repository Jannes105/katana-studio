// DOM-free logic for the USB test page: descriptor decoding, interface auto-pick,
// paced sending, the serial RQ1 helper and the slider value guard.
// Everything here runs under `node --test` (see usb-core.test.js).

import {
  IDENTITY_REQUEST,
  MODEL_CODE_KATANA_100,
  ROLAND_ID,
  buildDt1,
  buildRq1,
  hex,
  packetizeSysex,
  parseMessage,
  sendIntervalMs,
  toLinear,
  UsbMidiParser,
} from '../shared/katana.js';

// Device ID 0x10 is what the amp answered on the PC; any device ID is accepted.
export const EXPECTED_IDENTITY_PREFIX = Object.freeze([0xf0, 0x7e, 0x10, 0x06, 0x02, 0x41, 0x07, 0x05]);
export const DEFAULT_DEVICE_ID = 0x10;

const hex2 = (n) => '0x' + Number(n).toString(16).padStart(2, '0').toUpperCase();
const hex4 = (n) => '0x' + Number(n).toString(16).padStart(4, '0').toUpperCase();
export { hex2, hex4 };

// ---------------------------------------------------------------------------
// Raw descriptor decoding
// ---------------------------------------------------------------------------

const CLASS_NAMES = {
  0x00: 'defined per interface',
  0x01: 'audio',
  0x02: 'CDC',
  0x03: 'HID',
  0x08: 'mass storage',
  0x09: 'hub',
  0x0a: 'CDC data',
  0x0e: 'video',
  0xef: 'miscellaneous',
  0xfe: 'application specific',
  0xff: 'vendor specific',
};
const TRANSFER_TYPES = ['control', 'isochronous', 'bulk', 'interrupt'];

export function className(code) {
  return CLASS_NAMES[code] ?? 'unknown';
}

export function isRolandDescriptor(d) {
  return d.length >= 6 && d[0] >= 6 && d[1] === 0x24 && d[2] === 0xf1 && d[3] === 0x02;
}

function decodeEndpoint(d) {
  const address = d[2];
  return {
    address,
    number: address & 0x0f,
    direction: address & 0x80 ? 'in' : 'out',
    type: TRANSFER_TYPES[d[3] & 0x03],
    maxPacketSize: (d[4] | (d[5] << 8)) & 0x07ff,
    interval: d[6],
  };
}

// Walks a raw descriptor blob (device descriptor and/or configuration descriptors, in any
// order, as returned by GET_DESCRIPTOR or Android's getRawDescriptors()).
// Returns { device, configurations, roland, lines, error }.
//   configurations[].interfaces is a flat list with one entry per interface + alternate setting.
//   roland lists every Roland class-specific descriptor (06 24 F1 02 ...).
//   lines is a human-readable dump, one line per descriptor.
export function parseRawDescriptors(raw) {
  const bytes = Array.from(raw ?? []);
  const out = { device: null, configurations: [], roland: [], lines: [], error: null };
  let config = null;
  let iface = null;
  let i = 0;

  while (i < bytes.length) {
    const len = bytes[i];
    if (len < 2 || i + len > bytes.length) {
      out.error = `Malformed descriptor at offset ${i}: bLength=${len}, ${bytes.length - i} byte(s) left`;
      out.lines.push(`${hex(bytes.slice(i))}  | <- ${out.error}`);
      break;
    }
    const d = bytes.slice(i, i + len);
    const type = d[1];
    let text;

    if (type === 0x01 && len >= 18) {
      out.device = {
        usbVersion: d[2] | (d[3] << 8),
        deviceClass: d[4],
        deviceSubclass: d[5],
        deviceProtocol: d[6],
        maxPacketSize0: d[7],
        vendorId: d[8] | (d[9] << 8),
        productId: d[10] | (d[11] << 8),
        deviceVersion: d[12] | (d[13] << 8),
        numConfigurations: d[17],
      };
      const v = out.device;
      text = `DEVICE usb=${hex4(v.usbVersion)} class=${hex2(v.deviceClass)}/${hex2(v.deviceSubclass)}/${hex2(v.deviceProtocol)}`
        + ` (${className(v.deviceClass)}) VID=${hex4(v.vendorId)} PID=${hex4(v.productId)}`
        + ` bcdDevice=${hex4(v.deviceVersion)} configurations=${v.numConfigurations}`;
    } else if (type === 0x02 && len >= 9) {
      config = {
        value: d[5],
        totalLength: d[2] | (d[3] << 8),
        numInterfaces: d[4],
        attributes: d[7],
        maxPower: d[8] * 2,
        interfaces: [],
      };
      iface = null;
      out.configurations.push(config);
      text = `CONFIGURATION value=${config.value} totalLength=${config.totalLength} interfaces=${config.numInterfaces}`
        + ` attributes=${hex2(config.attributes)} maxPower=${config.maxPower} mA`;
    } else if (type === 0x04 && len >= 9) {
      iface = {
        id: d[2],
        alternateSetting: d[3],
        numEndpoints: d[4],
        interfaceClass: d[5],
        interfaceSubclass: d[6],
        interfaceProtocol: d[7],
        name: '',
        endpoints: [],
        classSpecific: [],
      };
      if (!config) {
        config = { value: null, totalLength: null, numInterfaces: null, attributes: null, maxPower: null, interfaces: [] };
        out.configurations.push(config);
      }
      config.interfaces.push(iface);
      text = `  INTERFACE ${iface.id} alt ${iface.alternateSetting}: class=${hex2(iface.interfaceClass)}/${hex2(iface.interfaceSubclass)}/${hex2(iface.interfaceProtocol)}`
        + ` (${className(iface.interfaceClass)}) endpoints=${iface.numEndpoints}`;
    } else if (type === 0x05 && len >= 7) {
      const ep = decodeEndpoint(d);
      if (iface) iface.endpoints.push(ep);
      text = `    ENDPOINT ${hex2(ep.address)} ${ep.direction.toUpperCase()} ${ep.type} maxPacket=${ep.maxPacketSize} interval=${ep.interval}`;
    } else if (type === 0x0b && len >= 8) {
      text = `  INTERFACE ASSOCIATION first=${d[2]} count=${d[3]} class=${hex2(d[4])}/${hex2(d[5])}/${hex2(d[6])}`;
    } else if (type === 0x24) {
      if (iface) iface.classSpecific.push(d);
      if (isRolandDescriptor(d)) {
        const entry = {
          interfaceId: iface ? iface.id : null,
          alternateSetting: iface ? iface.alternateSetting : null,
          bytes: d,
          // Byte meaning taken from the Linux snd-usb-audio Roland quirk; unverified for the Gen 3.
          inPorts: d[4],
          outPorts: d[5],
        };
        out.roland.push(entry);
        text = `    ROLAND MIDI DESCRIPTOR (06 24 F1 02): probably ${entry.inPorts} in port(s), ${entry.outPorts} out port(s)`;
      } else {
        text = `    CS_INTERFACE subtype=${hex2(d[2] ?? 0)}`;
      }
    } else if (type === 0x25) {
      text = `      CS_ENDPOINT subtype=${hex2(d[2] ?? 0)}`;
    } else {
      text = `  descriptor type ${hex2(type)}`;
    }

    out.lines.push(`${hex(d)}  | ${text}`);
    i += len;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Common device model
// ---------------------------------------------------------------------------
// interfaces: flat list, one entry per interface + alternate setting:
//   { id, alternateSetting, interfaceClass, interfaceSubclass, interfaceProtocol, name,
//     endpoints: [{ address, number, direction, type, maxPacketSize, interval }] }

// Converts a WebUSB USBDevice (or a plain object of the same shape) into the common model.
export function normalizeWebUsbDevice(device) {
  const configurations = Array.from(device.configurations ?? [], (c) => ({
    value: c.configurationValue,
    name: c.configurationName ?? '',
    interfaces: Array.from(c.interfaces ?? []).flatMap((itf) =>
      Array.from(itf.alternates ?? [], (alt) => ({
        id: itf.interfaceNumber,
        alternateSetting: alt.alternateSetting,
        interfaceClass: alt.interfaceClass,
        interfaceSubclass: alt.interfaceSubclass,
        interfaceProtocol: alt.interfaceProtocol,
        name: alt.interfaceName ?? '',
        endpoints: Array.from(alt.endpoints ?? [], (ep) => ({
          address: ep.endpointNumber | (ep.direction === 'in' ? 0x80 : 0),
          number: ep.endpointNumber,
          direction: ep.direction,
          type: ep.type,
          maxPacketSize: ep.packetSize,
          interval: null,
        })),
      }))),
  }));
  const activeValue = device.configuration?.configurationValue ?? configurations[0]?.value ?? null;
  const active = configurations.find((c) => c.value === activeValue) ?? configurations[0];
  return {
    vendorId: device.vendorId,
    productId: device.productId,
    deviceClass: device.deviceClass,
    deviceSubclass: device.deviceSubclass,
    deviceProtocol: device.deviceProtocol,
    manufacturerName: device.manufacturerName ?? '',
    productName: device.productName ?? '',
    serialNumber: device.serialNumber ?? '',
    usbVersion: device.usbVersionMajor === undefined ? '' : `${device.usbVersionMajor}.${device.usbVersionMinor}.${device.usbVersionSubminor}`,
    activeConfiguration: device.configuration?.configurationValue ?? null,
    configurations,
    interfaces: active ? active.interfaces : [],
  };
}

// Human-readable lines for a flat interface list.
export function describeInterfaces(interfaces) {
  const lines = [];
  for (const itf of interfaces ?? []) {
    lines.push(`interface ${itf.id} alt ${itf.alternateSetting}: class=${hex2(itf.interfaceClass)}/${hex2(itf.interfaceSubclass)}/${hex2(itf.interfaceProtocol)}`
      + ` (${className(itf.interfaceClass)})${itf.name ? ` "${itf.name}"` : ''}, ${itf.endpoints?.length ?? 0} endpoint(s)`);
    for (const ep of itf.endpoints ?? []) {
      lines.push(`    endpoint ${hex2(ep.address)} (#${ep.number}) ${String(ep.direction).toUpperCase()} ${ep.type} maxPacket=${ep.maxPacketSize}`
        + (ep.interval === null || ep.interval === undefined ? '' : ` interval=${ep.interval}`));
    }
  }
  return lines;
}

const isMidiCapable = (ep) => ep.type === 'bulk' || ep.type === 'interrupt';

// Endpoints of one direction that could carry MIDI, bulk first.
export function usableEndpoints(itf, direction) {
  return (itf?.endpoints ?? [])
    .filter((ep) => ep.direction === direction && isMidiCapable(ep))
    .sort((a, b) => (a.type === 'bulk' ? 0 : 1) - (b.type === 'bulk' ? 0 : 1));
}

// Picks the interface + alternate setting that most likely carries MIDI:
// it must have an IN and an OUT endpoint of type bulk or interrupt.
// Preference: vendor class 0xFF, then audio/MIDI-streaming, then no isochronous endpoints
// (audio streaming), then the lowest interface number and alternate setting.
// Returns null when nothing fits, otherwise
// { interfaceId, alternateSetting, inEndpoint, outEndpoint, score, reason, candidates }.
export function pickInterface(interfaces) {
  const candidates = [];
  for (const itf of interfaces ?? []) {
    const ins = usableEndpoints(itf, 'in');
    const outs = usableEndpoints(itf, 'out');
    if (ins.length === 0 || outs.length === 0) continue;
    const reasons = [];
    let score = 0;
    if (itf.interfaceClass === 0xff) { score += 100; reasons.push('vendor class 0xFF'); }
    if (itf.interfaceClass === 0x01 && itf.interfaceSubclass === 0x03) { score += 50; reasons.push('audio class, MIDI streaming'); }
    if (!(itf.endpoints ?? []).some((ep) => ep.type === 'isochronous')) { score += 10; reasons.push('no isochronous endpoints'); }
    reasons.push(`${ins[0].type} IN ${hex2(ins[0].address)}, ${outs[0].type} OUT ${hex2(outs[0].address)}`);
    candidates.push({
      interfaceId: itf.id,
      alternateSetting: itf.alternateSetting,
      inEndpoint: ins[0],
      outEndpoint: outs[0],
      score,
      reason: reasons.join('; '),
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score || a.interfaceId - b.interfaceId || a.alternateSetting - b.alternateSetting);
  return { ...candidates[0], candidates };
}

// Transfer length for the IN read loop: a multiple of the packet size, at least 512 bytes.
export function readLength(maxPacketSize) {
  const size = Number.isInteger(maxPacketSize) && maxPacketSize > 0 ? maxPacketSize : 64;
  return size * Math.max(8, Math.ceil(512 / size));
}

// ---------------------------------------------------------------------------
// Identity verdict
// ---------------------------------------------------------------------------

// msg: result of parseMessage(). Returns { verified, exact, isKatana100, modelCode, text }.
// verified = the reply has the expected shape (Roland, family 07 05); the device ID may differ.
export function checkIdentity(msg) {
  if (!msg || msg.type !== 'identity') {
    return { verified: false, exact: false, isKatana100: false, modelCode: null, text: 'Not an identity reply.' };
  }
  const b = msg.bytes;
  const exact = EXPECTED_IDENTITY_PREFIX.every((v, i) => b[i] === v);
  const verified = EXPECTED_IDENTITY_PREFIX.every((v, i) => i === 2 || b[i] === v);
  const isKatana100 = verified && msg.modelCode === MODEL_CODE_KATANA_100;
  let text;
  if (!verified) {
    text = `Identity reply does NOT match the expected prefix ${hex(EXPECTED_IDENTITY_PREFIX)}`
      + (msg.manufacturerId === ROLAND_ID ? ' (Roland device, but a different family).' : ' (not a Roland device).');
  } else if (!isKatana100) {
    text = `Roland Katana family reply, but model code is ${hex2(msg.modelCode)}, expected ${hex2(MODEL_CODE_KATANA_100)} (KATANA-100).`;
  } else {
    text = `KATANA-100 confirmed (model code ${hex2(msg.modelCode)}, device ID ${hex2(msg.deviceId)})`
      + (exact ? '.' : `; note: device ID differs from the expected ${hex2(EXPECTED_IDENTITY_PREFIX[2])}.`);
  }
  return { verified, exact, isKatana100, modelCode: msg.modelCode, text };
}

// ---------------------------------------------------------------------------
// Paced sending
// ---------------------------------------------------------------------------

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Sends MIDI messages one at a time, with the BTS gap after each one.
// A queued item is either a byte array or a function that returns the bytes at the moment of
// sending (or null to skip). Priority items overtake normal ones that are still waiting.
export class PacedSender {
  constructor({ write, interval = sendIntervalMs, now = defaultNow, sleep = defaultSleep }) {
    this.write = write;
    this.interval = interval;
    this.now = now;
    this.sleep = sleep;
    this.queue = [];
    this.running = false;
    this.nextAt = 0;
  }

  send(source, { priority = false } = {}) {
    return new Promise((resolve, reject) => {
      const item = { source, priority, resolve, reject };
      if (priority) {
        let i = 0;
        while (i < this.queue.length && this.queue[i].priority) i++;
        this.queue.splice(i, 0, item);
      } else {
        this.queue.push(item);
      }
      this.pump();
    });
  }

  // Drops everything that has not been sent yet.
  clear(reason = 'send queue cleared') {
    const dropped = this.queue.splice(0);
    for (const item of dropped) item.reject(new Error(reason));
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const wait = this.nextAt - this.now();
        if (wait > 0) await this.sleep(wait);
        const item = this.queue.shift();
        if (!item) break; // cleared while waiting
        try {
          const bytes = typeof item.source === 'function' ? item.source() : item.source;
          if (bytes === null || bytes === undefined) {
            item.resolve(null);
            continue;
          }
          await this.write(bytes);
          this.nextAt = this.now() + this.interval(bytes.length);
          item.resolve(bytes);
        } catch (e) {
          item.reject(e);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

// Latest-value-wins: while a value for a key is waiting to be sent, newer values replace it.
// `send(sourceFn)` must call sourceFn at the moment of sending (PacedSender does).
export class LatestValueQueue {
  constructor(send, onError = () => {}) {
    this.send = send;
    this.onError = onError;
    this.pending = new Map();
  }

  // build(value) returns the bytes to send.
  set(key, value, build) {
    const waiting = this.pending.has(key);
    this.pending.set(key, { value, build });
    if (waiting) return;
    Promise.resolve(this.send(() => {
      const entry = this.pending.get(key);
      if (!entry) return null; // cleared in the meantime
      this.pending.delete(key);
      return entry.build(entry.value);
    })).catch((e) => {
      this.pending.delete(key);
      this.onError(e);
    });
  }

  clear() {
    this.pending.clear();
  }

  get size() {
    return this.pending.size;
  }
}

// ---------------------------------------------------------------------------
// Slider value guard
// ---------------------------------------------------------------------------

// Holds one slider value. Values reported by the amp are ignored while the user drags the
// control and for holdMs afterwards. value === null means "not read from the amp yet".
export class GuardedValue {
  constructor({ min = 0, max = 100, holdMs = 300 } = {}) {
    this.min = min;
    this.max = max;
    this.holdMs = holdMs;
    this.value = null;
    this.dragging = false;
    this.lastUserAt = -Infinity;
  }

  clamp(v) {
    return Math.min(this.max, Math.max(this.min, Math.round(v)));
  }

  userSet(value, now) {
    this.value = this.clamp(value);
    this.lastUserAt = now;
    return this.value;
  }

  // Returns the new value, or null when there is no value to step from.
  userStep(delta, now) {
    if (this.value === null) return null;
    return this.userSet(this.value + delta, now);
  }

  beginDrag(now) {
    this.dragging = true;
    this.lastUserAt = now;
  }

  endDrag(now) {
    this.dragging = false;
    this.lastUserAt = now;
  }

  // Value reported by the amp on its own. Returns true when it was applied.
  applyRemote(value, now) {
    if (this.dragging || now - this.lastUserAt < this.holdMs) return false;
    this.value = value;
    return true;
  }

  // Value read on request (always applied unless the user is dragging right now).
  setFromAmp(value) {
    if (this.dragging) return false;
    this.value = value;
    return true;
  }

  invalidate() {
    this.value = null;
    this.dragging = false;
  }
}

// ---------------------------------------------------------------------------
// Range read analysis
// ---------------------------------------------------------------------------

// blocks: [{ linearAddress, data, at }] in arrival order; sentAt: time the RQ1 went out.
export function analyzeRangeRead(blocks, sentAt) {
  let dataBytes = 0;
  let ascending = true;
  let outOfOrder = 0;
  let duplicates = 0;
  const seen = new Set();
  let previous = -1;
  let maxLength = 0;
  for (const b of blocks) {
    dataBytes += b.data.length;
    maxLength = Math.max(maxLength, b.data.length);
    if (seen.has(b.linearAddress)) duplicates++;
    seen.add(b.linearAddress);
    if (b.linearAddress <= previous) { ascending = false; outOfOrder++; }
    previous = b.linearAddress;
  }
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  return {
    count: blocks.length,
    dataBytes,
    ascending,
    outOfOrder,
    duplicates,
    maxDataLength: maxLength,
    firstReplyMs: first ? first.at - sentAt : null,
    totalMs: last ? last.at - sentAt : null,
  };
}

// ---------------------------------------------------------------------------
// The link: USB-MIDI framing, serial requests, writes
// ---------------------------------------------------------------------------

// Talks Roland SysEx over a raw byte pipe that carries USB-MIDI packets.
//   write(packets, message): async, sends the raw packets to the OUT endpoint.
//   feed(chunk): call with every raw IN transfer.
// Only one request (RQ1 or identity) is outstanding at a time. DT1 replies are matched by
// address; everything else is reported as unsolicited through onDt1.
export class KatanaLink {
  constructor({ write, log = () => {}, interval = sendIntervalMs, now = defaultNow, sleep = defaultSleep }) {
    this.log = log;
    this.now = now;
    this.cable = 0;
    this.deviceId = DEFAULT_DEVICE_ID;
    this.parser = new UsbMidiParser();
    this.sender = new PacedSender({
      write: (message) => write(packetizeSysex(message, this.cable), message),
      interval,
      now,
      sleep,
    });
    this.writes = new LatestValueQueue(
      (source) => this.sender.send(source, { priority: true }),
      (e) => this.log('err', `Write failed: ${describeError(e)}`),
    );
    this.pending = null; // the one outstanding request
    this.chain = Promise.resolve();
    this.quiet = false; // suppresses per-message logging (timing measurement)
    this.stats = { transfers: 0, bytesIn: 0, messagesIn: 0, messagesOut: 0, oddTransfers: 0 };

    // Hooks for the UI.
    this.onDt1 = null; // (message, { solicited, cable })
    this.onIdentity = null; // (message, { solicited, cable })
    this.onOther = null; // (message, { cable })
  }

  setCable(cable) {
    this.cable = cable;
  }

  // Drops all state after a disconnect or close.
  reset(reason = 'connection closed') {
    this.parser.reset();
    this.writes.clear();
    this.sender.clear(reason);
    const req = this.pending;
    if (req) req.finish(new Error(reason));
  }

  clearWrites() {
    this.writes.clear();
  }

  // ---- incoming ----

  feed(chunk) {
    const bytes = Array.from(chunk);
    this.stats.transfers++;
    this.stats.bytesIn += bytes.length;
    if (bytes.length % 4 !== 0) {
      this.stats.oddTransfers++;
      this.log('err', `IN transfer of ${bytes.length} bytes is not a multiple of 4: this may not be USB-MIDI packet framing.`);
    }
    let messages;
    try {
      messages = this.parser.push(bytes);
    } catch (e) {
      this.log('err', `USB-MIDI parser failed: ${describeError(e)}`);
      this.parser.reset();
      return;
    }
    for (const { cable, bytes: raw } of messages) {
      this.stats.messagesIn++;
      let msg;
      try {
        msg = parseMessage(raw);
      } catch (e) {
        this.log('err', `Cannot parse message ${hex(raw)}: ${describeError(e)}`);
        continue;
      }
      this.dispatch(msg, cable);
    }
  }

  dispatch(msg, cable) {
    const req = this.pending;
    if (msg.type === 'identity') {
      const solicited = !!req && req.kind === 'identity';
      if (!this.quiet) this.log('in', `← [cable ${cable}] identity reply: ${hex(msg.bytes)}`);
      if (solicited) req.finish(null, { message: msg, cable, ms: this.now() - req.sentAt });
      this.onIdentity?.(msg, { solicited, cable });
      return;
    }
    if (msg.type === 'dt1') {
      if (!msg.checksumOk) {
        this.log('err', `← [cable ${cable}] DT1 with BAD CHECKSUM ignored: ${hex(msg.bytes)}`);
        return;
      }
      const solicited = !!req && req.kind === 'rq1'
        && msg.linearAddress >= req.start && msg.linearAddress < req.end;
      if (!this.quiet) {
        this.log('in', `← [cable ${cable}] DT1 ${hex(msg.address)} (${msg.data.length} byte${msg.data.length === 1 ? '' : 's'}`
          + `${solicited ? '' : ', unsolicited'}): ${hex(msg.data)}`);
      }
      if (solicited) {
        req.blocks.push({ address: msg.address, linearAddress: msg.linearAddress, data: msg.data, at: this.now(), cable });
        if (req.range) req.restartQuietTimer();
        else req.finish(null);
      }
      this.onDt1?.(msg, { solicited, cable });
      return;
    }
    if (!this.quiet) this.log('in', `← [cable ${cable}] ${msg.type}: ${hex(msg.bytes)}`);
    this.onOther?.(msg, { cable });
  }

  // ---- outgoing ----

  // Sends one complete message through the pacing queue. beforeWrite runs right before the
  // bytes go out (used to arm reply matching before a fast reply can arrive).
  sendMessage(message, note, { priority = false, beforeWrite = null } = {}) {
    return this.sender.send(() => {
      beforeWrite?.();
      this.stats.messagesOut++;
      if (!this.quiet) this.log('out', `→ [cable ${this.cable}] ${hex(message)}${note ? `  (${note})` : ''}`);
      return message;
    }, { priority });
  }

  // Immediate DT1 (paced, ahead of waiting reads).
  writeDt1(address, data, note) {
    return this.sendMessage(buildDt1(this.deviceId, address, data), note, { priority: true });
  }

  // DT1 for a control that is being dragged: the newest value for an address replaces one that
  // is still waiting.
  writeLatest(address, data, note) {
    this.writes.set(hex(address), data, (latest) => {
      const message = buildDt1(this.deviceId, address, latest);
      this.stats.messagesOut++;
      if (!this.quiet) this.log('out', `→ [cable ${this.cable}] ${hex(message)}${note ? `  (${note})` : ''}`);
      return message;
    });
  }

  enqueue(run) {
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => {});
    return result;
  }

  // Identity request. Resolves with { message, cable, ms }.
  identity({ timeoutMs = 1500, note = 'identity request' } = {}) {
    return this.enqueue(() => new Promise((resolve, reject) => {
      const req = this.makeRequest('identity', resolve, reject);
      this.sendMessage(Array.from(IDENTITY_REQUEST), note, {
        beforeWrite: () => req.arm(timeoutMs, `No identity reply within ${timeoutMs} ms`),
      }).catch((e) => req.finish(e));
    }));
  }

  // RQ1. size: linear number of bytes or 4 bytes in 7-bit notation.
  //   range = false: resolves with the first DT1 inside the requested range:
  //                  { address, linearAddress, data, ms, cable }.
  //   range = true:  collects every DT1 inside the range until quietMs of silence, resolves
  //                  with { blocks, sentAt }.
  // Rejects when nothing arrives within timeoutMs.
  request(address, size, { range = false, timeoutMs = 1500, quietMs = 300, note = '' } = {}) {
    return this.enqueue(() => new Promise((resolve, reject) => {
      const message = buildRq1(this.deviceId, address, size);
      const req = this.makeRequest('rq1', () => {
        if (range) resolve({ blocks: req.blocks, sentAt: req.sentAt });
        else resolve({ ...req.blocks[0], ms: req.blocks[0].at - req.sentAt });
      }, reject);
      req.start = toLinear(address);
      req.end = req.start + (typeof size === 'number' ? size : toLinear(size));
      req.range = range;
      req.restartQuietTimer = () => {
        clearTimeout(req.timer);
        req.timer = setTimeout(() => req.finish(null), quietMs);
      };
      this.sendMessage(message, note, {
        beforeWrite: () => req.arm(timeoutMs, `No reply within ${timeoutMs} ms for RQ1 ${hex(address)}`),
      }).catch((e) => req.finish(e));
    }));
  }

  makeRequest(kind, resolve, reject) {
    const req = { kind, blocks: [], sentAt: null, timer: null, done: false };
    req.arm = (timeoutMs, timeoutText) => {
      if (req.done) return;
      this.pending = req;
      req.sentAt = this.now();
      req.timer = setTimeout(() => req.finish(new Error(timeoutText)), timeoutMs);
    };
    req.finish = (error, value) => {
      if (req.done) return;
      req.done = true;
      clearTimeout(req.timer);
      if (this.pending === req) this.pending = null;
      if (error) reject(error);
      else resolve(value);
    };
    return req;
  }
}

export function describeError(e) {
  if (e === null || e === undefined) return 'unknown error';
  if (typeof e === 'string') return e;
  const name = e.name && e.name !== 'Error' ? `${e.name}: ` : '';
  const code = e.code !== undefined && e.code !== null && e.code !== '' ? ` [code ${e.code}]` : '';
  return `${name}${e.message ?? String(e)}${code}`;
}
