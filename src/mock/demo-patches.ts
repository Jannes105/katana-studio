// Invented demo content for the mock amp: different amp types, variations, effects and colours per channel, so
// the UI can be tried with something that looks like a real amp. No real patch data in the repository (PLAN 4.7).
// Laid out with our parameter list, so the mock follows the same (partly derived) offsets as the app.

import { patchName, u4x4 } from '../protocol/encoding';
import { instanceParam } from '../model/schema';
import type { Address } from '../protocol/address';
import {
  AMP_KNOBS,
  AMP_POWERAMP_VARIATION,
  CONTOUR_SELECT,
  contourFreqShift,
  AMP_RESONANCE,
  AMP_TYPE,
  AMP_VARIATION,
  DELAY2_SWITCH,
  EFFECTS,
  NS_RELEASE,
  NS_SWITCH,
  NS_THRESHOLD,
} from '../model/params';

export interface DemoPatch {
  readonly name: string;
  /** Gain, Volume, Bass, Middle, Treble, Presence. */
  readonly knobs: readonly [number, number, number, number, number, number];
  readonly ampType: number;
  readonly variation: 0 | 1;
  /** On/off of Booster, Mod, FX, Delay, Reverb. */
  readonly on: readonly [number, number, number, number, number];
  /** Active variation of Booster, Mod, FX, Delay, Reverb. */
  readonly colours: readonly [number, number, number, number, number];
  /** NS on, threshold, release. */
  readonly ns: readonly [number, number, number];
}

/** Index 0 = Panel, 1–8 = A1–B4, 9 = PREVIEW. */
export const DEMO_PATCHES: readonly DemoPatch[] = [
  {
    name: 'PANEL',
    knobs: [50, 50, 50, 50, 50, 50],
    ampType: 5,
    variation: 0,
    on: [1, 0, 0, 0, 1],
    colours: [0, 0, 0, 0, 0],
    ns: [0, 5, 50],
  },
  {
    name: 'Glass Clean',
    knobs: [30, 62, 45, 55, 60, 52],
    ampType: 1,
    variation: 0,
    on: [0, 1, 0, 0, 1],
    colours: [0, 1, 0, 0, 2],
    ns: [1, 15, 50],
  },
  {
    name: 'Warm Pushed',
    knobs: [58, 50, 52, 64, 50, 48],
    ampType: 2,
    variation: 1,
    on: [1, 0, 0, 1, 1],
    colours: [1, 0, 0, 1, 0],
    ns: [1, 30, 45],
  },
  {
    name: 'Edge Crunch',
    knobs: [62, 48, 50, 60, 58, 55],
    ampType: 3,
    variation: 1,
    on: [1, 0, 0, 1, 1],
    colours: [0, 0, 0, 0, 0],
    ns: [1, 35, 50],
  },
  {
    name: 'Solo Lead',
    knobs: [70, 44, 55, 66, 52, 46],
    ampType: 4,
    variation: 0,
    on: [1, 0, 1, 1, 1],
    colours: [2, 0, 1, 2, 1],
    ns: [1, 42, 40],
  },
  {
    name: 'Acoustic Sim',
    knobs: [20, 60, 40, 50, 62, 50],
    ampType: 0,
    variation: 0,
    on: [0, 1, 0, 0, 1],
    colours: [0, 0, 0, 0, 1],
    ns: [1, 10, 50],
  },
  {
    name: 'Brown Wall',
    knobs: [76, 46, 60, 48, 56, 58],
    ampType: 5,
    variation: 1,
    on: [0, 0, 0, 0, 1],
    colours: [0, 0, 0, 0, 0],
    ns: [1, 48, 35],
  },
  {
    name: 'Ambient Swell',
    knobs: [36, 54, 46, 52, 58, 50],
    ampType: 1,
    variation: 1,
    on: [0, 1, 1, 1, 1],
    colours: [0, 2, 2, 1, 2],
    ns: [1, 20, 60],
  },
  {
    name: 'Tight Rhythm',
    knobs: [66, 50, 58, 42, 60, 54],
    ampType: 4,
    variation: 1,
    on: [1, 0, 0, 0, 1],
    colours: [1, 0, 0, 0, 0],
    ns: [1, 55, 30],
  },
  {
    name: 'PREVIEW',
    knobs: [50, 50, 50, 50, 50, 50],
    ampType: 1,
    variation: 0,
    on: [0, 0, 0, 0, 0],
    colours: [0, 0, 0, 0, 0],
    ns: [0, 5, 50],
  },
];

/** Invented type values per effect and variation (raw; names come with our type tables). */
const DEMO_TYPES: readonly (readonly [number, number, number])[] = [
  [9, 10, 13], // booster
  [23, 25, 3], // mod
  [16, 0, 29], // fx
  [0, 3, 4], // delay
  [0, 3, 2], // reverb
];

/**
 * Invented knob values of booster, delay and reverb (raw), the same in every variation except the delay time,
 * so the effect pages show something plausible instead of zeros.
 */
const DEMO_KNOBS: Readonly<Record<string, number>> = {
  'booster.drive': 50,
  'booster.bottom': 50,
  'booster.tone': 55,
  'booster.solo': 0,
  'booster.soloLevel': 60,
  'booster.effectLevel': 50,
  'booster.directMix': 0,
  'delay.time': 400,
  'delay.feedback': 25,
  'delay.highCut': 14,
  'delay.effectLevel': 40,
  'delay.directMix': 100,
  'delay.tapTime': 50,
  'delay.modRate': 40,
  'delay.modDepth': 50,
  'delay.range': 1,
  'delay.filter': 1,
  'delay.feedbackPhase': 0,
  'delay.delayPhase': 0,
  'delay.modSwitch': 0,
  'reverb.layerMode': 2,
  'reverb.time': 29,
  'reverb.preDelay': 10,
  'reverb.lowCut': 0,
  'reverb.highCut': 14,
  'reverb.density': 8,
  'reverb.effectLevel': 35,
  'reverb.directMix': 100,
  'reverb.springColor': 50,
};

/** Writes a demo patch into memory at `base` (a stored slot or the current patch). */
export function writeDemoPatch(
  poke: (address: Address, data: readonly number[]) => void,
  base: Address,
  p: DemoPatch,
): void {
  poke(base, patchName.encode(p.name));
  AMP_KNOBS.forEach((def, i) => poke(base + def.at, [p.knobs[i] ?? 50]));
  poke(base + AMP_TYPE.at, [p.ampType]);
  poke(base + AMP_RESONANCE.at, [50]);
  poke(base + AMP_VARIATION.at, [p.variation]);
  // Some variety: contour and power amp variation on every second channel.
  const odd = p.name.length % 2 === 1;
  poke(base + AMP_POWERAMP_VARIATION.at, [odd ? 1 : 0]);
  poke(base + CONTOUR_SELECT.at, [odd ? 2 : 0]);
  poke(base + contourFreqShift(2).at, [odd ? 62 : 50]);
  EFFECTS.forEach((g, k) => {
    poke(base + g.switch.at, [p.on[k] ?? 0]);
    poke(base + g.colour.at, [p.colours[k] ?? 0]);
    g.typeBlocks.forEach((at, c) => poke(base + at, [DEMO_TYPES[k]?.[c] ?? 0]));
    for (const c of [0, 1, 2]) {
      for (const p of g.params) {
        const def = instanceParam(g, c, p);
        const v =
          (DEMO_KNOBS[`${g.key}.${p.key}`] ?? p.min) + (p.key === 'time' && g.key === 'delay' ? 80 * c : 0);
        poke(base + def.at, def.encoding === 'u4x4' ? u4x4.encode(v) : [v]);
      }
    }
  });
  poke(base + DELAY2_SWITCH.at, [0]);
  poke(base + NS_SWITCH.at, [p.ns[0]]);
  poke(base + NS_THRESHOLD.at, [p.ns[1]]);
  poke(base + NS_RELEASE.at, [p.ns[2]]);
}
