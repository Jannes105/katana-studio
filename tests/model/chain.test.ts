import { describe, expect, it } from 'vitest';
import { CHAIN_VARIANTS, chainOrder, type ChainSettings } from '../../src/model/chain';

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
