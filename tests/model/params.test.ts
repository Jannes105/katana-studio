import { describe, expect, it } from 'vitest';
import { addr } from '../../src/protocol/address';
import { PATCH_BLOCKS, blockKey } from '../../src/protocol/blocks';
import {
  AMP_TYPE,
  AMP_TYPE_NAMES,
  EFFECTS,
  NS_THRESHOLD,
  PATCH_NAME,
  PATCH_PARAMS,
  VARIATION_PARAMS,
  effectType,
} from '../../src/model/params';
import { encodingSize, instanceParam, visibleFor, writable } from '../../src/model/schema';
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

describe('knobs of booster, delay and reverb (Phase 1b)', () => {
  const byKey = (key: string) => {
    const g = EFFECTS.find((e) => e.key === key);
    if (!g) throw new Error(`no ${key}`);
    return g;
  };

  it('have unique keys per effect and lie inside their variation block, after the type byte', () => {
    for (const g of EFFECTS) {
      expect(new Set(g.params.map((p) => p.key)).size, g.key).toBe(g.params.length);
      for (const c of [0, 1, 2]) {
        const block = PATCH_BLOCKS.find((b) => b.offset === g.paramBlocks[c]);
        for (const p of g.params) {
          expect(p.at, p.key).toBeGreaterThanOrEqual(1);
          const q = instanceParam(g, c, p);
          if (block)
            expect(q.at + encodingSize(q.encoding), q.key).toBeLessThanOrEqual(block.offset + block.length);
        }
      }
    }
    const keys = VARIATION_PARAMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ranges are valid and tables match their range', () => {
    for (const p of VARIATION_PARAMS) {
      expect(p.min, p.key).toBeLessThanOrEqual(p.max);
      const table = p.display?.table;
      if (table) expect(p.max, p.key).toBe(table.length - 1);
      for (const t of p.visibleFor ?? [])
        expect(t, p.key).toBeLessThan(byKey(p.key.split('.')[0] ?? '').typeNames.length);
    }
  });

  it('keep the layout of the analysis: offsets, encodings and offsets of the shown value', () => {
    const at = (g: string) => Object.fromEntries(byKey(g).params.map((p) => [p.key, p.at]));
    expect(at('booster')).toEqual({
      drive: 1,
      bottom: 2,
      tone: 3,
      solo: 4,
      soloLevel: 5,
      effectLevel: 6,
      directMix: 7,
    });
    const delay = byKey('delay').params;
    const time = delay.find((p) => p.key === 'time');
    expect([time?.encoding, time?.min, time?.max]).toEqual(['u4x4', 1, 2000]);
    expect(delay.map((p) => p.at)).toEqual([1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const reverb = byKey('reverb').params;
    expect(reverb.find((p) => p.key === 'time')?.display?.rawOffset).toBe(-1);
    expect(reverb.find((p) => p.key === 'preDelay')?.encoding).toBe('u4x4');
    expect(reverb.find((p) => p.key === 'layerMode')?.readonly).toBe(true);
    expect(byKey('booster').params.find((p) => p.key === 'bottom')?.display?.rawOffset).toBe(50);
  });

  it('instanceParam addresses the variation block', () => {
    const delay = byKey('delay');
    const time = delay.params[0];
    if (!time) throw new Error('no time');
    const q = instanceParam(delay, 1, time);
    expect(q.at).toBe(addr(0, 0, 0x2a, 0x01));
    expect(q.key).toBe('delay.1.time');
    expect(() => instanceParam(delay, 3, time)).toThrow(RangeError);
  });

  it('visibility follows the type: tap time only for PAN, spring colour only for SPRING', () => {
    const find = (g: string, k: string) => byKey(g).params.find((p) => p.key === k);
    const tap = find('delay', 'tapTime');
    const highCut = find('delay', 'highCut');
    const spring = find('reverb', 'springColor');
    if (!tap || !highCut || !spring) throw new Error('missing');
    expect([0, 1, 7].map((t) => visibleFor(tap, t))).toEqual([false, true, false]);
    expect([0, 7].map((t) => visibleFor(highCut, t))).toEqual([true, false]);
    expect([2, 3].map((t) => visibleFor(spring, t))).toEqual([false, true]);
    expect(visibleFor(find('delay', 'feedback') ?? tap, undefined)).toBe(true);
  });
});

describe('writable (PLAN 4.4: only confirmed addresses are written)', () => {
  it('needs status C and no read-only flag; names are never written', () => {
    expect(writable(NS_THRESHOLD)).toBe(true);
    expect(writable({ ...NS_THRESHOLD, status: 'D' })).toBe(false);
    expect(writable({ ...NS_THRESHOLD, readonly: true })).toBe(false);
    expect(writable({ ...PATCH_NAME })).toBe(false);
  });
});

describe('status after the address check on the amp (2026-11-16)', () => {
  it('everything of Phase 1b is writable; only layer mode and the Delay 2 switch stay locked', () => {
    const locked = [...PATCH_PARAMS, ...VARIATION_PARAMS]
      .filter((p) => !writable(p))
      .map((p) => p.key.replace(/^reverb\.\d\./, 'reverb.n.'));
    expect([...new Set(locked)].sort()).toEqual(['delay2.on', 'patch.name', 'reverb.n.layerMode']);
  });
});
