import { describe, expect, it } from 'vitest';
import { ADDR, SIZE, addr } from '../../src/protocol/address';
import {
  IDENTITY_REQUEST,
  acceptsDeviceId,
  buildDt1,
  buildRq1,
  checksum,
  hex,
  parseHex,
  parseMessage,
} from '../../src/protocol/sysex';

describe('SysEx', () => {
  it('checksum', () => {
    expect(checksum([0x7f, 0x00, 0x00, 0x01, 0x01])).toBe(0x7f);
    expect(checksum([0x00, 0x00, 0x00, 0x00])).toBe(0);
  });

  it('builds RQ1 with the size in 7-bit notation', () => {
    expect(hex(buildRq1(0x10, ADDR.currentPatch, 16))).toBe(
      'F0 41 10 01 05 07 11 20 00 00 00 00 00 00 10 50 F7',
    );
    // 200 bytes = 00 00 01 48, not 00 00 00 C8.
    expect(buildRq1(0x10, ADDR.currentPatch, 200).slice(11, 15)).toEqual([0x00, 0x00, 0x01, 0x48]);
    expect(buildRq1(0x10, ADDR.currentPatch, SIZE.patch).slice(11, 15)).toEqual([0x00, 0x02, 0x00, 0x00]);
    expect(() => buildRq1(0x10, ADDR.currentPatch, 0)).toThrow(RangeError);
  });

  it('matches real messages from the captures', () => {
    expect(hex(buildRq1(0x10, ADDR.patchNumber, addr(0, 0, 0x01, 0x00)))).toBe(
      'F0 41 10 01 05 07 11 00 00 00 00 00 00 01 00 7F F7',
    );
    expect(hex(buildRq1(0x10, ADDR.system, addr(0, 0x01, 0, 0)))).toBe(
      'F0 41 10 01 05 07 11 10 00 00 00 00 01 00 00 6F F7',
    );
  });

  it('builds DT1', () => {
    expect(hex(buildDt1(0x10, ADDR.editorMode, [0x01]))).toBe('F0 41 10 01 05 07 12 7F 00 00 01 01 7F F7');
    expect(() => buildDt1(0x10, ADDR.editorMode, [0x80])).toThrow(RangeError);
    expect(() => buildDt1(0x10, ADDR.editorMode, [])).toThrow(RangeError);
    expect(() => buildDt1(0x80, ADDR.editorMode, [1])).toThrow(RangeError);
  });

  it('parses the identity reply', () => {
    const m = parseMessage(parseHex('F0 7E 10 06 02 41 07 05 00 00 06 00 00 00 F7'));
    expect(m).toMatchObject({ type: 'identity', deviceId: 0x10, manufacturerId: 0x41, modelCode: 0x06 });
  });

  it('parses DT1 and RQ1 with linear addresses', () => {
    const dt1 = parseMessage(buildDt1(0x10, addr(0x20, 0x00, 0x58, 0x00), [1, 40, 30]));
    expect(dt1).toMatchObject({ type: 'dt1', address: addr(0x20, 0x00, 0x58, 0x00), data: [1, 40, 30] });
    expect(dt1.type === 'dt1' && dt1.checksumOk).toBe(true);

    const rq1 = parseMessage(buildRq1(0x10, ADDR.storedPatchBase, SIZE.patch));
    expect(rq1).toMatchObject({
      type: 'rq1',
      address: ADDR.storedPatchBase,
      size: SIZE.patch,
      checksumOk: true,
    });
  });

  it('parses a reported patch number from a capture', () => {
    const m = parseMessage(parseHex('F0 41 10 01 05 07 12 00 00 00 00 00 08 78 F7'));
    expect(m).toMatchObject({ type: 'dt1', address: ADDR.patchNumber, data: [0x00, 0x08], checksumOk: true });
  });

  it('flags a bad checksum', () => {
    const broken = buildDt1(0x10, addr(0x20, 0x00, 0x58, 0x00), [1]);
    broken[broken.length - 2] = (broken[broken.length - 2] ?? 0) ^ 1;
    expect(parseMessage(broken)).toMatchObject({ type: 'dt1', checksumOk: false });
  });

  it('classifies everything else without throwing', () => {
    expect(parseMessage([0xfe]).type).toBe('short');
    expect(parseMessage([]).type).toBe('short');
    expect(parseMessage([0xf0, 0x43, 0x00, 0xf7]).type).toBe('sysex-other');
    expect(parseMessage(IDENTITY_REQUEST).type).toBe('sysex-other');
    expect(parseMessage(parseHex('F0 41 10 01 05 07 13 00 00 00 00 00 00 F7')).type).toBe('roland-other');
    expect(parseMessage(parseHex('F0 41 10 01 05 07 12 00 F7')).type).toBe('roland-other');
    expect(parseMessage(parseHex('F0 41 10 01 05 07 12 80 00 00 00 01 7F F7')).type).toBe('roland-other');
  });

  it('accepts the learned device ID and 7F', () => {
    expect(acceptsDeviceId(0x10, 0x10)).toBe(true);
    expect(acceptsDeviceId(0x10, 0x7f)).toBe(true);
    expect(acceptsDeviceId(0x10, 0x11)).toBe(false);
  });

  it('hex helpers', () => {
    expect(hex([0, 0x7f, 0xf0])).toBe('00 7F F0');
    expect(parseHex(' 20 00,58  0 ')).toEqual([0x20, 0x00, 0x58, 0x00]);
    expect(() => parseHex('20 xx')).toThrow(SyntaxError);
  });
});
