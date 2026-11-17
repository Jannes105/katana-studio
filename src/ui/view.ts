// What the screens show, derived from the connection state. Plain functions (no Svelte), so they are testable.

import { chainOrder, type ChainBlock } from '../model/chain';
import { EFFECTS, effectType } from '../model/params';
import { CHAIN_VARIANT, sectionByKey } from '../model/sections';
import { effectView, readRaw, type EffectView } from '../model/patch';
import { writable, type ParamDef, type VariantGroup } from '../model/schema';
import type { ByteChange, ConnectionState } from '../state/connection';

export type Dot = 'ok' | 'warn' | 'error' | 'off' | 'busy';

/** The small connection dot in the header corner. */
export function connectionDot(s: ConnectionState): Dot {
  switch (s.phase) {
    case 'connected':
      return s.readOnly ? 'warn' : 'ok';
    case 'error':
      return 'error';
    case 'waiting':
      return 'off';
    default:
      return 'busy';
  }
}

/** True once a whole patch has been read (also while disconnected: the values stay visible, frozen). */
export function hasPatch(s: ConnectionState): boolean {
  return s.current.complete;
}

export interface ParamView {
  readonly value: number | undefined;
  /** Stored value, when known and different from the current one. */
  readonly stored: number | null;
  readonly changed: boolean;
}

export function paramView(s: ConnectionState, def: ParamDef): ParamView {
  const value = readRaw(s.current, def);
  const stored = s.unsavedKnown ? readRaw(s.stored, def) : undefined;
  const changed = value !== undefined && stored !== undefined && stored !== value;
  return { value, stored: changed && stored !== undefined ? stored : null, changed };
}

/** One effect for the list and its page: what the amp has now, and what differs from the stored slot. */
export interface EffectRow extends EffectView {
  readonly group: VariantGroup;
  readonly switchChanged: boolean;
  readonly colourChanged: boolean;
  /** Type changed against the stored slot, by variation. */
  readonly typeChanged: readonly boolean[];
  /** Anything of this effect differs from the stored slot. */
  readonly changed: boolean;
}

export function effectRows(s: ConnectionState): EffectRow[] {
  return EFFECTS.map((g) => {
    const typeChanged = [0, 1, 2].map((c) => paramView(s, effectType(g, c)).changed);
    const switchChanged = paramView(s, g.switch).changed;
    const colourChanged = paramView(s, g.colour).changed;
    return {
      ...effectView(s.current, g),
      group: g,
      switchChanged,
      colourChanged,
      typeChanged,
      changed: switchChanged || colourChanged || typeChanged.some(Boolean),
    };
  });
}

/** Remembered unsaved changes of the channel now shown (PLAN 2). */
export function rememberedHere(s: ConnectionState): readonly ByteChange[] {
  return s.patchIndex === null ? [] : (s.remembered.get(s.patchIndex) ?? []);
}

/** Controls can change the amp right now (mirrors AmpConnection.canWrite, from the state alone). */
export function canEdit(s: ConnectionState): boolean {
  return (
    s.phase === 'connected' &&
    !s.readOnly &&
    !s.reading &&
    !s.backingUp &&
    !s.saving &&
    !s.loading &&
    s.current.complete
  );
}

/** A control for this parameter is live: editing allowed and the parameter writable (PLAN 4.4). */
export function editable(s: ConnectionState, def: ParamDef): boolean {
  return canEdit(s) && writable(def);
}

/** Values can be looked at but are frozen or about to change: shown dimmed. */
export function dimmed(s: ConnectionState): boolean {
  return s.phase !== 'connected' || s.reading;
}

/** A line of the effects list in chain order. The foot volume has no page and is left out. */
export type ChainItem = Exclude<ChainBlock, 'footVolume'>;

/** The chain settings of the current patch (chain variant and positions), 0 where not read yet. */
export function chainSettings(s: ConnectionState) {
  const v = (def: ParamDef | undefined) => (def ? (readRaw(s.current, def) ?? 0) : 0);
  return {
    variant: Math.min(8, v(CHAIN_VARIANT)),
    pedalFx: v(sectionByKey('pedalFx').position),
    sendReturn: v(sectionByKey('sendReturn').position),
    eq1: v(sectionByKey('eq1').position),
    eq2: v(sectionByKey('eq2').position),
  };
}

/** The blocks of the effects list, in the order the signal runs through them (PLAN 5, Phase 2). */
export function chainItems(s: ConnectionState): ChainItem[] {
  return chainOrder(chainSettings(s)).filter((b): b is ChainItem => b !== 'footVolume');
}
