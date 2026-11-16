// What the screens show, derived from the connection state. Plain functions (no Svelte), so they are testable.

import { readRaw } from '../model/patch';
import type { ParamDef } from '../model/schema';
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

/** Remembered unsaved changes of the channel now shown (PLAN 2). */
export function rememberedHere(s: ConnectionState): readonly ByteChange[] {
  return s.patchIndex === null ? [] : (s.remembered.get(s.patchIndex) ?? []);
}

/** Values can be looked at but are frozen or about to change: shown dimmed. */
export function dimmed(s: ConnectionState): boolean {
  return s.phase !== 'connected' || s.reading;
}
