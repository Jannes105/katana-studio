import { describe, expect, it } from 'vitest';
import { addr } from '../../src/protocol/address';
import { PATCH_BLOCKS, blockKey } from '../../src/protocol/blocks';
import {
  AMP_TYPE,
  AMP_TYPE_NAMES,
  EFFECTS,
  NS_THRESHOLD,
  PATCH_PARAMS,
  effectType,
} from '../../src/model/params';
import { encodingSize } from '../../src/model/schema';
import { patchBlockAt } from '../../src/model/patch';

describe('block keys', () => {
  it('are the offset as three hex digits and unique', () => {
    expect(blockKey(addr(0, 0, 0x06, 0))).toBe('000600');
    expect(blockKey(addr(0, 0x01, 0x1e, 0))).toBe('011E00');
    expect(new Set(PATCH_BLOCKS.map((b) => b.key)).size).toBe(PATCH_BLOCKS.length);
  });
});

describe('parameter list (PLAN 4.4)', () => {
  it('has unique keys', () => {
    const keys = PATCH_PARAMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every parameter lies inside one block of the patch', () => {
    for (const p of PATCH_PARAMS) {
      const b = patchBlockAt(p.at);
      expect(b, p.key).toBeDefined();
      if (b) expect(p.at + encodingSize(p.encoding), p.key).toBeLessThanOrEqual(b.offset + b.length);
    }
  });

  it('ranges are valid and tables match their range', () => {
    for (const p of PATCH_PARAMS) {
      expect(p.min, p.key).toBeLessThanOrEqual(p.max);
      const table = p.display?.table;
      if (table && table.length > 0) expect(p.max, p.key).toBe(table.length - 1);
    }
  });

  it('keeps the confirmed addresses of protocol-notes 2.8', () => {
    expect(NS_THRESHOLD.at).toBe(addr(0, 0, 0x58, 0x01));
    expect(AMP_TYPE.at).toBe(addr(0, 0, 0x06, 0x07));
    expect(AMP_TYPE_NAMES).toHaveLength(6);
    const reverb = EFFECTS.find((g) => g.key === 'reverb');
    expect(reverb?.switch.at).toBe(addr(0, 0, 0x08, 0x05)); // not 08 04 (Q3)
    expect(EFFECTS.map((g) => g.colour.at - addr(0, 0, 0x04, 0))).toEqual([0, 1, 2, 3, 4]);
  });

  it('variation blocks start at block boundaries, mod and fx keep their parameters apart', () => {
    for (const g of EFFECTS) {
      for (const at of [...g.typeBlocks, ...g.paramBlocks]) {
        expect(
          PATCH_BLOCKS.some((b) => b.offset === at),
          `${g.key} ${blockKey(at)}`,
        ).toBe(true);
      }
    }
    const mod = EFFECTS.find((g) => g.key === 'mod');
    expect(mod?.typeBlocks.map(blockKey)).toEqual(['001000', '001200', '001400']);
    expect(mod?.paramBlocks.map(blockKey)).toEqual(['001C00', '001E00', '002000']);
  });

  it('effect types have our name tables and are writable within them', () => {
    expect(EFFECTS.map((g) => g.typeNames.length)).toEqual([23, 31, 31, 8, 5]);
    for (const g of EFFECTS) {
      const t = effectType(g, 1);
      expect(t.readonly).toBe(g.typeNames.length === 0);
      expect(t.at).toBe(g.typeBlocks[1]);
    }
    const booster = EFFECTS[0];
    if (!booster) throw new Error('no effects');
    expect(() => effectType(booster, 3)).toThrow(RangeError);
  });
});
