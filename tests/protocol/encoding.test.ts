import { describe, expect, it } from 'vitest';
import { ascii, patchName, u2x4, u2x7, u4x4, u7 } from '../../src/protocol/encoding';

describe('value encodings', () => {
  it('u7', () => {
    expect(u7.encode(100)).toEqual([100]);
    expect(u7.decode([40])).toBe(40);
    expect(() => u7.encode(128)).toThrow(RangeError);
    expect(() => u7.encode(-1)).toThrow(RangeError);
    expect(() => u7.decode([1, 2])).toThrow(RangeError);
  });

  it('u2x4 (patch number) and u4x4', () => {
    expect(u2x4.encode(8)).toEqual([0x00, 0x08]);
    expect(u2x4.decode([0x00, 0x08])).toBe(8);
    expect(u2x4.encode(0xff)).toEqual([0x0f, 0x0f]);
    expect(() => u2x4.encode(256)).toThrow(RangeError);
    expect(u4x4.encode(0x1234)).toEqual([1, 2, 3, 4]);
    expect(u4x4.decode([1, 2, 3, 4])).toBe(0x1234);
    expect(u4x4.size).toBe(4);
  });

  it('u2x7 (commands)', () => {
    expect(u2x7.encode(8)).toEqual([0x00, 0x08]);
    expect(u2x7.encode(200)).toEqual([0x01, 0x48]);
    expect(u2x7.decode([0x01, 0x48])).toBe(200);
    expect(() => u2x7.encode(16384)).toThrow(RangeError);
  });

  it('u2x4 and u2x7 agree for patch indexes 0–9 (protocol-notes 2.5)', () => {
    for (let i = 0; i <= 9; i++) expect(u2x4.encode(i)).toEqual(u2x7.encode(i));
  });

  it('patch name: ascii(16), padded with spaces', () => {
    const bytes = patchName.encode('COMP CLEAN');
    expect(bytes).toHaveLength(16);
    expect(bytes.slice(10)).toEqual([32, 32, 32, 32, 32, 32]);
    expect(patchName.decode(bytes)).toBe('COMP CLEAN');
    expect(() => patchName.encode('A'.repeat(17))).toThrow(RangeError);
    expect(() => patchName.encode('Ä')).toThrow(RangeError);
    expect(() => patchName.encode('~')).toThrow(RangeError); // 126 is outside 32–125
    expect(ascii(3).encode('}')).toEqual([125, 32, 32]);
  });
});
