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

/** Which setting moves a block, and its values (booster, mod, FX and delay move by the chain variant). */
const MOVED_BY: Partial<Record<ChainBlock, { key: keyof ChainSettings; values: readonly number[] }>> = {
  pedalFx: { key: 'pedalFx', values: [0, 1] },
  booster: { key: 'variant', values: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  mod: { key: 'variant', values: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  fx: { key: 'variant', values: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  delay: { key: 'variant', values: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  eq1: { key: 'eq1', values: [0, 1] },
  eq2: { key: 'eq2', values: [0, 1] },
  sendReturn: { key: 'sendReturn', values: [0, 1, 2] },
};

/** True if the amp lets this block move at all. */
export function movable(block: ChainBlock): boolean {
  return MOVED_BY[block] !== undefined;
}

/**
 * The settings that move `block` one step earlier (-1) or later (+1) in the chain, or null if it cannot go
 * further. Only the setting that belongs to the block changes; among several candidates the one that keeps the
 * other blocks most in place wins (fewest pairs swapped).
 */
export function moveBlock(s: ChainSettings, block: ChainBlock, dir: -1 | 1): ChainSettings | null {
  const by = MOVED_BY[block];
  if (!by) return null;
  const now = chainOrder(s);
  const at = now.indexOf(block);
  const others = now.filter((b) => b !== block);
  let best: { s: ChainSettings; dist: number; cost: number } | null = null;
  for (const v of by.values) {
    if (v === s[by.key]) continue;
    const next = { ...s, [by.key]: v };
    const order = chainOrder(next);
    const delta = order.indexOf(block) - at;
    if (Math.sign(delta) !== dir) continue;
    const rest = order.filter((b) => b !== block);
    let cost = 0;
    for (let i = 0; i < rest.length; i++)
      for (let j = i + 1; j < rest.length; j++) {
        const a = rest[i] as ChainBlock;
        const b = rest[j] as ChainBlock;
        if (others.indexOf(a) > others.indexOf(b)) cost++;
      }
    const dist = Math.abs(delta);
    if (!best || cost < best.cost || (cost === best.cost && dist < best.dist)) best = { s: next, dist, cost };
  }
  return best?.s ?? null;
}

/**
 * The settings that bring `block` as close as possible to index `target` of the chain (drag and drop). Only the
 * block's own setting changes; the current setting counts too, so a drop on a place the amp does not allow
 * keeps or picks the nearest allowed one. Ties: fewest other blocks moved, then the current setting.
 */
export function placeBlock(s: ChainSettings, block: ChainBlock, target: number): ChainSettings {
  const by = MOVED_BY[block];
  if (!by) return s;
  const others = chainOrder(s).filter((b) => b !== block);
  let best = { s, dist: Infinity, cost: Infinity, same: true };
  for (const v of by.values) {
    const next = v === s[by.key] ? s : { ...s, [by.key]: v };
    const order = chainOrder(next);
    const dist = Math.abs(order.indexOf(block) - target);
    const rest = order.filter((b) => b !== block);
    let cost = 0;
    for (let i = 0; i < rest.length; i++)
      for (let j = i + 1; j < rest.length; j++)
        if (others.indexOf(rest[i] as ChainBlock) > others.indexOf(rest[j] as ChainBlock)) cost++;
    const same = next === s;
    if (
      dist < best.dist ||
      (dist === best.dist && cost < best.cost) ||
      (dist === best.dist && cost === best.cost && same && !best.same)
    )
      best = { s: next, dist, cost, same };
  }
  return best.s;
}
