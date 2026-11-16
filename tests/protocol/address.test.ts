import { describe, expect, it } from 'vitest';
import {
  ADDR,
  SIZE,
  addr,
  formatAddress,
  fromLinear,
  storedPatchAddress,
  storedPatchIndexOf,
  toLinear,
} from '../../src/protocol/address';

describe('address math', () => {
  it('carries at 7 bits', () => {
    expect(toLinear([0x00, 0x00, 0x01, 0x00])).toBe(128);
    expect(fromLinear(128)).toEqual([0x00, 0x00, 0x01, 0x00]);
    expect(fromLinear(addr(0x20, 0x00, 0x00, 0x7f) + 1)).toEqual([0x20, 0x00, 0x01, 0x00]);
    expect(fromLinear(addr(0x20, 0x7f, 0x7f, 0x7f) + 1)).toEqual([0x21, 0x00, 0x00, 0x00]);
  });

  it('round-trips and formats', () => {
    for (const n of [0, 1, 127, 128, 16383, 16384, 128 ** 4 - 1]) expect(toLinear(fromLinear(n))).toBe(n);
    expect(formatAddress(addr(0x20, 0x00, 0x58, 0x01))).toBe('20 00 58 01');
  });

  it('rejects bad input', () => {
    expect(() => toLinear([0x80, 0, 0, 0])).toThrow(RangeError);
    expect(() => toLinear([0, 0, 0])).toThrow(RangeError);
    expect(() => fromLinear(-1)).toThrow(RangeError);
    expect(() => fromLinear(128 ** 4)).toThrow(RangeError);
    expect(() => fromLinear(1.5)).toThrow(RangeError);
  });

  it('has the range sizes used on the amp', () => {
    expect(fromLinear(SIZE.patch)).toEqual([0x00, 0x02, 0x00, 0x00]);
    expect(fromLinear(SIZE.storedPatchStride)).toEqual([0x00, 0x10, 0x00, 0x00]);
  });
});

describe('stored patch slots: index n lives in PATCH(n+1)', () => {
  // Confirmed on the amp for 0–8 (protocol-notes 2.7). An off-by-one here would write backups to the wrong slot.
  const expected: [number, number[]][] = [
    [0, [0x20, 0x10, 0x00, 0x00]], // Panel
    [1, [0x20, 0x20, 0x00, 0x00]], // A1
    [2, [0x20, 0x30, 0x00, 0x00]],
    [3, [0x20, 0x40, 0x00, 0x00]],
    [4, [0x20, 0x50, 0x00, 0x00]], // A4
    [5, [0x20, 0x60, 0x00, 0x00]], // B1
    [6, [0x20, 0x70, 0x00, 0x00]],
    [7, [0x21, 0x00, 0x00, 0x00]], // B3: the second digit has carried
    [8, [0x21, 0x10, 0x00, 0x00]], // B4
    [9, [0x21, 0x20, 0x00, 0x00]], // PREVIEW
  ];

  it.each(expected)('index %i', (index, bytes) => {
    expect(fromLinear(storedPatchAddress(index))).toEqual(bytes);
    expect(storedPatchIndexOf(storedPatchAddress(index))).toBe(index);
    expect(storedPatchIndexOf(storedPatchAddress(index) + addr(0, 0, 0x58, 0x01))).toBe(index);
  });

  it('rejects other indexes', () => {
    expect(() => storedPatchAddress(10)).toThrow(RangeError);
    expect(() => storedPatchAddress(-1)).toThrow(RangeError);
    expect(() => storedPatchAddress(1.5)).toThrow(RangeError);
  });

  it('knows which addresses are not in a stored slot', () => {
    expect(storedPatchIndexOf(ADDR.currentPatch)).toBeUndefined();
    expect(storedPatchIndexOf(addr(0x21, 0x30, 0x00, 0x00))).toBeUndefined();
  });
});
