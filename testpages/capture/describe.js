// Human-readable one-line summaries of MIDI messages for the on-screen log and the text export.
// The area names are our own working labels; what is verified is tracked in docs/protocol-notes.md.

import {
  ADDR, SIZE, PATCH_OFFSET, PATCH_NAME_LENGTH, PATCH_SLOT_NAMES, MODEL_CODE_KATANA_100,
  decodeAscii, decodeNibbles, fromLinear, hex, parseMessage, toLinear,
} from '../shared/katana.js';

const SLOT_STRIDE = toLinear(SIZE.storedPatchStride);
const CURRENT_PATCH = toLinear(ADDR.currentPatch);
const STORED_BASE = toLinear(ADDR.storedPatchBase);
const STORED_END = STORED_BASE + PATCH_SLOT_NAMES.length * SLOT_STRIDE;
const SYSTEM = toLinear(ADDR.system);
const TEMP = toLinear([0x30, 0x00, 0x00, 0x00]);
const COMMAND = toLinear([0x7f, 0x00, 0x00, 0x00]);

const COMMAND_NAMES = new Map([
  [toLinear(ADDR.editorLevel), 'editor level'],
  [toLinear(ADDR.editorMode), 'editor mode'],
  [toLinear(ADDR.patchSelect), 'PATCH_SELECT'],
  [toLinear(ADDR.patchWrite), 'PATCH_WRITE'],
]);

// Which memory area an address belongs to.
// Returns { area, label, slotIndex?, offset? } with offset = linear offset inside a patch.
export function describeAddress(address) {
  const lin = toLinear(address);
  if (lin >= COMMAND) {
    return { area: 'command', label: COMMAND_NAMES.get(lin) ?? 'command area' };
  }
  if (lin >= TEMP) return { area: 'temp', label: 'temp area' };
  if (lin >= STORED_END) return { area: 'unknown', label: 'beyond stored slots' };
  if (lin >= STORED_BASE) {
    const slotIndex = Math.floor((lin - STORED_BASE) / SLOT_STRIDE);
    const offset = (lin - STORED_BASE) % SLOT_STRIDE;
    return {
      area: 'stored',
      label: `slot ${slotIndex} ${PATCH_SLOT_NAMES[slotIndex]} +${hex(fromLinear(offset).slice(1))}`,
      slotIndex,
      offset,
    };
  }
  if (lin >= CURRENT_PATCH) {
    const offset = lin - CURRENT_PATCH;
    return { area: 'current', label: `current patch +${hex(fromLinear(offset).slice(1))}`, offset };
  }
  if (lin >= SYSTEM) return { area: 'system', label: 'system' };
  if (lin === toLinear(ADDR.patchNumber)) return { area: 'setup', label: 'patch number' };
  return { area: 'setup', label: 'setup area' };
}

function decodeDt1Value(info, data) {
  if (info.label === 'patch number' && data.length === 2) {
    const index = decodeNibbles(data);
    return `index ${index} (${PATCH_SLOT_NAMES[index] ?? '?'})`;
  }
  if (info.offset === PATCH_OFFSET.name && data.length >= PATCH_NAME_LENGTH) {
    return `name "${decodeAscii(data.slice(0, PATCH_NAME_LENGTH))}"`;
  }
  if (info.area === 'command' && data.length <= 2) return `value ${hex(data)}`;
  return '';
}

// bytes: one complete MIDI message. options.reply: see Recorder.addMessage.
export function describeBytes(bytes, { reply } = {}) {
  const m = parseMessage(bytes);
  switch (m.type) {
    case 'identity': {
      const model = m.modelCode === MODEL_CODE_KATANA_100 ? 'KATANA-100' : 'unknown model';
      return `identity reply, device ${hex([m.deviceId])}, model code ${hex([m.modelCode])} (${model})`;
    }
    case 'dt1': {
      const info = describeAddress(m.address);
      const parts = [`DT1 ${hex(m.address)} len ${m.data.length}`, info.label];
      const value = decodeDt1Value(info, m.data);
      if (value) parts.push(value);
      if (reply === true) parts.push('reply');
      if (reply === false) parts.push('UNSOLICITED');
      if (!m.checksumOk) parts.push('BAD CHECKSUM');
      return parts.join(' | ');
    }
    case 'rq1': {
      const size = m.data.length === 4 ? `size ${hex(m.data)} (${toLinear(m.data)})` : `size? ${hex(m.data)}`;
      const parts = [`RQ1 ${hex(m.address)} ${size}`, describeAddress(m.address).label];
      if (!m.checksumOk) parts.push('BAD CHECKSUM');
      return parts.join(' | ');
    }
    case 'roland-other':
      return `Roland message, command ${hex([m.command ?? 0])}`;
    case 'sysex-other':
      if (m.bytes[1] === 0x7e && m.bytes[3] === 0x06 && m.bytes[4] === 0x01) return 'identity request';
      return 'other SysEx';
    default:
      return `short message (status ${hex([m.bytes[0] ?? 0])})`;
  }
}

export function describeEvent(event) {
  if (event.dir === 'marker') return event.text;
  const bytes = event.bytes.split(' ').map((b) => parseInt(b, 16));
  return describeBytes(bytes, { reply: event.reply });
}
