import { describe, expect, it } from 'vitest';
import {
  CHAIN_VARIANTS,
  chainOrder,
  moveBlock,
  movable,
  placeBlock,
  type ChainSettings,
} from '../../src/model/chain';

const base: ChainSettings = { variant: 2, pedalFx: 0, sendReturn: 0, eq1: 0, eq2: 0 };

describe('chain order (protocol-notes 2.8, Chain)', () => {
  it('variant 2 with everything in its default place', () => {
    expect(chainOrder(base)).toEqual([
      'pedalFx',
      'booster',
      'mod',
      'fx',
      'eq1',
      'eq2',
      'amp',
      'footVolume',
      'sendReturn',
      'delay',
      'delay2',
      'reverb',
    ]);
  });

  it('the variant decides what comes before the amp; delay before the amp only in 3, 6 and 8', () => {
    const beforeAmp = (variant: number) => {
      const o = chainOrder({ ...base, variant, pedalFx: 1 });
      return o.slice(0, o.indexOf('eq1'));
    };
    expect(beforeAmp(0)).toEqual(['booster']);
    expect(beforeAmp(4)).toEqual(['mod', 'booster']);
    expect(beforeAmp(8)).toEqual(['mod', 'fx', 'booster', 'delay']);
    for (let v = 0; v < CHAIN_VARIANTS; v++) {
      const o = chainOrder({ ...base, variant: v });
      expect(o.indexOf('delay') < o.indexOf('amp'), `variant ${v}`).toBe([3, 6, 8].includes(v));
    }
  });

  it('pedal FX post amp, send/return after the amp or last', () => {
    const o = chainOrder({ ...base, variant: 0, pedalFx: 1, sendReturn: 2, eq1: 1, eq2: 1 });
    expect(o.slice(0, 5)).toEqual(['booster', 'amp', 'eq1', 'eq2', 'pedalFx']);
    expect(o[5]).toBe('sendReturn');
    expect(chainOrder({ ...base, sendReturn: 1 }).at(-1)).toBe('sendReturn');
  });

  it('one EQ on each side of the amp', () => {
    const around = (eq1: number, eq2: number) => {
      const o = chainOrder({ ...base, eq1, eq2 });
      const i = o.indexOf('amp');
      return o.slice(i - 1, i + 2);
    };
    expect(around(0, 1)).toEqual(['eq1', 'amp', 'eq2']);
    expect(around(1, 0)).toEqual(['eq2', 'amp', 'eq1']);
  });

  it('every block appears exactly once, in every setting', () => {
    for (let variant = 0; variant < CHAIN_VARIANTS; variant++)
      for (const pedalFx of [0, 1])
        for (const sendReturn of [0, 1, 2])
          for (const [eq1, eq2] of [
            [0, 0],
            [0, 1],
            [1, 0],
            [1, 1],
          ] as const) {
            const o = chainOrder({ variant, pedalFx, sendReturn, eq1, eq2 });
            expect(new Set(o).size).toBe(12);
            expect(o).toHaveLength(12);
          }
    expect(() => chainOrder({ ...base, variant: 9 })).toThrow(RangeError);
  });
});

describe('moving a block (chain page)', () => {
  it('booster after mod: variant 1 (BST MOD) → 4 (MOD BST), nothing else moves', () => {
    const s = { ...base, variant: 1 };
    const next = moveBlock(s, 'booster', 1);
    expect(next?.variant).toBe(4);
    expect(moveBlock(s, 'booster', -1)).toBeNull(); // booster is already first before the amp (pedal FX is not moved)
  });

  it('EQ, pedal FX and send/return move by their positions; the amp never moves', () => {
    expect(moveBlock(base, 'eq1', 1)).toEqual({ ...base, eq1: 1 });
    expect(moveBlock(base, 'pedalFx', 1)).toEqual({ ...base, pedalFx: 1 });
    expect(moveBlock(base, 'sendReturn', 1)).toEqual({ ...base, sendReturn: 1 });
    expect(moveBlock(base, 'sendReturn', -1)).toEqual({ ...base, sendReturn: 2 });
    expect(movable('amp')).toBe(false);
    expect(moveBlock(base, 'reverb', 1)).toBeNull();
  });

  it('every move really moves the block in the asked direction', () => {
    for (let variant = 0; variant < CHAIN_VARIANTS; variant++) {
      const s = { ...base, variant };
      for (const b of ['booster', 'mod', 'fx', 'delay'] as const)
        for (const dir of [-1, 1] as const) {
          const next = moveBlock(s, b, dir);
          if (next) expect(Math.sign(chainOrder(next).indexOf(b) - chainOrder(s).indexOf(b))).toBe(dir);
        }
    }
  });
});

describe('placing a block by drag and drop', () => {
  it('drops on an allowed place, or the nearest one; the rest stays in order', () => {
    const s = { ...base, variant: 0 }; // pedal FX, booster, EQ 1, EQ 2, amp, mod, fx, …
    // drag mod to index 2 (right after the booster): variant 1 (booster, mod)
    expect(placeBlock(s, 'mod', 2).variant).toBe(1);
    // drag mod to index 1 (before the booster): variant 4 (mod, booster)
    expect(placeBlock(s, 'mod', 1).variant).toBe(4);
    // drag EQ 1 far down: after the amp
    expect(placeBlock(s, 'eq1', 10).eq1).toBe(1);
    // a drop where it already is changes nothing
    expect(placeBlock(s, 'booster', 1)).toBe(s);
    // fixed blocks never move
    expect(placeBlock(s, 'amp', 0)).toBe(s);
  });

  it('send/return goes last when dropped at the end', () => {
    const order = chainOrder(base);
    expect(placeBlock(base, 'sendReturn', order.length - 1).sendReturn).toBe(1);
  });
});
