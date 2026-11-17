// Order of the effect chain (protocol-notes 2.8, "Chain"): built from the chain variant (02 00 + 0) and the
// positions of pedal FX, send/return, EQ 1 and EQ 2. Our own rules, derived from the local analysis of BOSS Tone
// Studio: the variant picks which of booster, mod, FX and delay come before the amp; the positions insert the rest.

export type ChainBlock =
  | 'pedalFx'
  | 'booster'
  | 'mod'
  | 'fx'
  | 'delay'
  | 'eq1'
  | 'eq2'
  | 'amp'
  | 'sendReturn'
  | 'footVolume'
  | 'delay2'
  | 'reverb';

/** Blocks before the amp, by chain variant 0–8 (in signal order). */
const BEFORE_AMP: readonly (readonly ChainBlock[])[] = [
  ['booster'],
  ['booster', 'mod'],
  ['booster', 'mod', 'fx'],
  ['booster', 'mod', 'fx', 'delay'],
  ['mod', 'booster'],
  ['mod', 'booster', 'fx'],
  ['mod', 'booster', 'fx', 'delay'],
  ['mod', 'fx', 'booster'],
  ['mod', 'fx', 'booster', 'delay'],
];

export const CHAIN_VARIANTS = BEFORE_AMP.length;

export interface ChainSettings {
  /** Chain variant 0–8. */
  readonly variant: number;
  /** Pedal FX: 0 input (first), 1 post amp. */
  readonly pedalFx: number;
  /** Send/return: 0 post FV, 1 post reverb (last), 2 right after the amp. */
  readonly sendReturn: number;
  /** EQ 1 and EQ 2: 0 amp in (before the amp), 1 amp out. */
  readonly eq1: number;
  readonly eq2: number;
}

/** The blocks of the chain in signal order (input and speaker not included). */
export function chainOrder(s: ChainSettings): ChainBlock[] {
  const before = BEFORE_AMP[s.variant];
  if (!before) throw new RangeError(`Bad chain variant ${s.variant}`);
  const after = (['mod', 'fx'] as const).filter((b) => !before.includes(b));
  // EQ 1 and EQ 2 around the amp: both in → EQ 1, EQ 2, amp; both out → amp, EQ 1, EQ 2; else EQ in, amp, EQ out.
  const ampWithEq: ChainBlock[] =
    s.eq1 === s.eq2
      ? s.eq1 === 0
        ? ['eq1', 'eq2', 'amp']
        : ['amp', 'eq1', 'eq2']
      : s.eq1 === 0
        ? ['eq1', 'amp', 'eq2']
        : ['eq2', 'amp', 'eq1'];
  const out: ChainBlock[] = [];
  if (s.pedalFx === 0) out.push('pedalFx');
  out.push(...before, ...ampWithEq);
  if (s.pedalFx !== 0) out.push('pedalFx');
  if (s.sendReturn === 2) out.push('sendReturn');
  out.push(...after, 'footVolume');
  if (s.sendReturn === 0) out.push('sendReturn');
  if (!before.includes('delay')) out.push('delay');
  out.push('delay2', 'reverb');
  if (s.sendReturn === 1) out.push('sendReturn');
  return out;
}
