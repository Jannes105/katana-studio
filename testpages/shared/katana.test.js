import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDR, SIZE, IDENTITY_REQUEST, UsbMidiParser,
  addOffset, buildDt1, buildRq1, checksum, decodeAscii, decodeNibbles, encodeNibbles,
  fromLinear, hex, packetizeSysex, parseHex, parseMessage, sendIntervalMs, storedPatchAddress, toLinear,
} from './katana.js';

test('hex and parseHex round-trip', () => {
  assert.equal(hex([0, 0x7f, 0xf0]), '00 7F F0');
  assert.deepEqual(parseHex(' 20 00,58  0 '), [0x20, 0x00, 0x58, 0x00]);
  assert.throws(() => parseHex('20 xx'));
});

test('address math carries at 7 bits', () => {
  assert.equal(toLinear([0x00, 0x00, 0x01, 0x00]), 128);
  assert.deepEqual(fromLinear(128), [0x00, 0x00, 0x01, 0x00]);
  assert.deepEqual(addOffset([0x20, 0x00, 0x00, 0x7f], 1), [0x20, 0x00, 0x01, 0x00]);
  assert.deepEqual(addOffset([0x20, 0x7f, 0x7f, 0x7f], 1), [0x21, 0x00, 0x00, 0x00]);
  assert.throws(() => toLinear([0x80, 0, 0, 0]));
});

test('stored patch addresses: index n lives in PATCH(n+1)', () => {
  assert.deepEqual(storedPatchAddress(0), [0x20, 0x10, 0x00, 0x00]); // Panel
  assert.deepEqual(storedPatchAddress(1), [0x20, 0x20, 0x00, 0x00]); // A1
  assert.deepEqual(storedPatchAddress(7), [0x21, 0x00, 0x00, 0x00]); // B3
  assert.deepEqual(storedPatchAddress(8), [0x21, 0x10, 0x00, 0x00]); // B4, confirmed on the amp
  assert.deepEqual(storedPatchAddress(9), [0x21, 0x20, 0x00, 0x00]); // PREVIEW
  assert.throws(() => storedPatchAddress(10));
});

test('checksum', () => {
  assert.equal(checksum([0x7f, 0x00, 0x00, 0x01, 0x01]), 0x7f);
  assert.equal(checksum([0x00, 0x00, 0x00, 0x00]), 0);
});

test('buildRq1 converts a linear size to 7-bit notation', () => {
  assert.equal(
    hex(buildRq1(0x10, ADDR.currentPatch, 16)),
    'F0 41 10 01 05 07 11 20 00 00 00 00 00 00 10 50 F7',
  );
  // 200 bytes = 00 00 01 48, not 00 00 00 C8
  assert.deepEqual(buildRq1(0x10, ADDR.currentPatch, 200).slice(11, 15), [0x00, 0x00, 0x01, 0x48]);
  assert.deepEqual(buildRq1(0x10, ADDR.currentPatch, SIZE.patch).slice(11, 15), [0x00, 0x02, 0x00, 0x00]);
});

test('buildDt1', () => {
  assert.equal(hex(buildDt1(0x10, ADDR.editorMode, [0x01])), 'F0 41 10 01 05 07 12 7F 00 00 01 01 7F F7');
  assert.throws(() => buildDt1(0x10, ADDR.editorMode, [0x80]));
  assert.throws(() => buildDt1(0x10, ADDR.editorMode, []));
});

test('parseMessage: identity reply', () => {
  const m = parseMessage(parseHex('F0 7E 10 06 02 41 07 05 00 00 06 00 00 00 F7'));
  assert.equal(m.type, 'identity');
  assert.equal(m.deviceId, 0x10);
  assert.equal(m.manufacturerId, 0x41);
  assert.equal(m.modelCode, 0x06);
});

test('parseMessage: DT1 and RQ1', () => {
  const dt1 = parseMessage(buildDt1(0x10, [0x20, 0x00, 0x58, 0x00], [1, 40, 30]));
  assert.equal(dt1.type, 'dt1');
  assert.deepEqual(dt1.address, [0x20, 0x00, 0x58, 0x00]);
  assert.deepEqual(dt1.data, [1, 40, 30]);
  assert.equal(dt1.checksumOk, true);

  const broken = buildDt1(0x10, [0x20, 0x00, 0x58, 0x00], [1]);
  broken[broken.length - 2] ^= 1;
  assert.equal(parseMessage(broken).checksumOk, false);

  const rq1 = parseMessage(buildRq1(0x10, ADDR.editorLevel, 1));
  assert.equal(rq1.type, 'rq1');
  assert.deepEqual(rq1.data, [0, 0, 0, 1]);
});

test('parseMessage: everything else', () => {
  assert.equal(parseMessage([0xfe]).type, 'short');
  assert.equal(parseMessage([0xf0, 0x43, 0x00, 0xf7]).type, 'sysex-other');
  assert.equal(parseMessage(IDENTITY_REQUEST).type, 'sysex-other');
});

test('value encodings', () => {
  assert.equal(decodeAscii([0x4b, 0x41, 0x54, 0x20, 0x20]), 'KAT');
  assert.equal(decodeNibbles([0x00, 0x08]), 8);
  assert.equal(decodeNibbles([0x01, 0x02, 0x03, 0x04]), 0x1234);
  assert.deepEqual(encodeNibbles(0x1234, 4), [1, 2, 3, 4]);
  assert.deepEqual(encodeNibbles(8, 2), [0, 8]);
});

test('send pacing', () => {
  assert.equal(sendIntervalMs(0), 20);
  assert.equal(sendIntervalMs(25), 28);
});

test('packetizeSysex: all three ending variants', () => {
  assert.equal(hex(packetizeSysex(IDENTITY_REQUEST)), '04 F0 7E 7F 07 06 01 F7'); // ends with 3
  assert.equal(hex(packetizeSysex([0xf0, 1, 2, 0xf7])), '04 F0 01 02 05 F7 00 00'); // ends with 1
  assert.equal(hex(packetizeSysex([0xf0, 1, 2, 3, 0xf7])), '04 F0 01 02 06 03 F7 00'); // ends with 2
  assert.equal(hex(packetizeSysex([0xf0, 0xf7])), '06 F0 F7 00');
  assert.equal(hex(packetizeSysex([0xf0, 1, 0xf7], 2)), '27 F0 01 F7');
  assert.throws(() => packetizeSysex([0x90, 1, 2]));
});

test('UsbMidiParser: round-trip, several messages per transfer', () => {
  const a = buildDt1(0x10, [0x20, 0x00, 0x58, 0x01], [42]);
  const b = buildRq1(0x10, ADDR.currentPatch, 16);
  const parser = new UsbMidiParser();
  const out = parser.push([...packetizeSysex(a), ...packetizeSysex(b)]);
  assert.deepEqual(out.map((m) => m.bytes), [a, b]);
});

test('UsbMidiParser: message split across transfers, even mid-packet', () => {
  const msg = buildDt1(0x10, ADDR.currentPatch, Array.from({ length: 40 }, (_, i) => i));
  const packets = Array.from(packetizeSysex(msg));
  const parser = new UsbMidiParser();
  assert.deepEqual(parser.push(packets.slice(0, 10)), []);
  assert.deepEqual(parser.push(packets.slice(10, 21)), []);
  const out = parser.push(packets.slice(21));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].bytes, msg);
});

test('UsbMidiParser: padding, short messages, cables', () => {
  const parser = new UsbMidiParser();
  const out = parser.push([
    0x00, 0x00, 0x00, 0x00, // padding
    0x0f, 0xfe, 0x00, 0x00, // active sensing, single byte
    0x1c, 0xc0, 0x05, 0x00, // program change on cable 1
    0x09, 0x90, 0x3c, 0x7f, // note on
  ]);
  assert.deepEqual(out, [
    { cable: 0, bytes: [0xfe] },
    { cable: 1, bytes: [0xc0, 0x05] },
    { cable: 0, bytes: [0x90, 0x3c, 0x7f] },
  ]);
});

test('UsbMidiParser: single-byte realtime does not break a running SysEx', () => {
  const parser = new UsbMidiParser();
  const out = parser.push([
    0x04, 0xf0, 0x01, 0x02,
    0x0f, 0xf8, 0x00, 0x00, // clock in between
    0x05, 0xf7, 0x00, 0x00,
  ]);
  assert.deepEqual(out, [
    { cable: 0, bytes: [0xf8] },
    { cable: 0, bytes: [0xf0, 0x01, 0x02, 0xf7] },
  ]);
});
