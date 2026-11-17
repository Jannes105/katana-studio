// Schema of our own parameter list (PLAN 4.4, 9.2 E 23). The list describes where a parameter lives in the
// patch memory (layout) and how the app shows it (presentation). It never holds values: the state layer keeps
// the raw bytes per block, and the model decodes from them, so a corrected list never invalidates a backup.

import type { Address } from '../protocol/address';

/** Value encodings (protocol-notes 2.5). */
export type Encoding = 'u7' | 'u4x4' | 'ascii16';

/** C: confirmed on the amp. D: derived (captures, analysis), not yet verified on the amp (protocol-notes 1). */
export type Status = 'C' | 'D';

export type Control = 'knob' | 'switch' | 'leds' | 'text';

/** How a raw value is shown. shown = (raw - rawOffset) * factor (PLAN 4.4: raw = shown + offset). */
export interface Display {
  readonly rawOffset?: number;
  readonly factor?: number;
  readonly unit?: string;
  /** Decimal places of the shown number (e.g. 1 for 0.5 ms steps). */
  readonly decimals?: number;
  /** Names by raw value (amp types, effect types). */
  readonly table?: readonly string[];
}

export interface ParamDef {
  /** Stable key, e.g. `amp.gain`. */
  readonly key: string;
  /** Label as on the amp; English in every UI language (PLAN 2). */
  readonly label: string;
  /**
   * Linear offset of the first byte: from the patch base for patch parameters, from the instance block for the
   * parameters of a VariantGroup.
   */
  readonly at: Address;
  readonly encoding: Encoding;
  /** Raw range; writes are clamped to it (PLAN 4.4). */
  readonly min: number;
  readonly max: number;
  readonly control: Control;
  readonly display?: Display;
  /** Never written (PLAN 4.4). */
  readonly readonly?: boolean;
  /** Shown in the rehearsal view (PLAN 5, design round: the Probe tab). */
  readonly rehearsal?: boolean;
  /**
   * Parameters of a VariantGroup: shown only for these type values (raw). Missing = every type. The value stays
   * in the patch either way; hiding is presentation only (PLAN 4.4: visibility rule).
   */
  readonly visibleFor?: readonly number[];
  /**
   * Shown only while these sibling parameters (keys in the same list, e.g. `harmonist.voice`) have one of the
   * given raw values; all conditions must hold. Presentation only, like visibleFor.
   */
  readonly showIf?: readonly { readonly key: string; readonly values: readonly number[] }[];
  /**
   * Group inside an effect page, e.g. `Voice 1` or `Low` (presentation only: how the UI splits a long list of
   * knobs into groups or pages).
   */
  readonly group?: string;
  /**
   * Bytes (offsets from the patch base) the amp changes by itself when this parameter is written; the app
   * reads them back afterwards (e.g. reverb layer mode and the Delay 2 switch, protocol-notes 2.8).
   */
  readonly alsoChanges?: readonly Address[];
  /** Raw steps per drag step of a knob (e.g. 5 for the delay time in ms); default 1. */
  readonly dragStep?: number;
  /**
   * Range and display that follow another parameter (assign min/max, PLAN 4.4): the sibling `key` picks the
   * target, `ranges[target]` is the range and display of that target. min/max above stay the raw range of the
   * field itself (the amp keeps e.g. 127 there although the target ends at 100). Missing entry = own range.
   */
  readonly rangeBy?: { readonly key: string; readonly ranges: readonly (RangeSpec | undefined)[] };
  readonly status: Status;
}

/** A raw range with its display, e.g. the range of an assign target. */
export interface RangeSpec {
  readonly min: number;
  readonly max: number;
  readonly display?: Display;
}

/** Range and display of a parameter, for use as an assign target. */
export function rangeOf(def: ParamDef): RangeSpec {
  return def.display ? { min: def.min, max: def.max, display: def.display } : { min: def.min, max: def.max };
}

/**
 * The range and display that apply now: the target's for a parameter with rangeBy (when the target is known
 * and listed), otherwise its own. Writes are clamped to this range; a raw value beyond it (127 for "up to the
 * end") is shown at the nearer end.
 */
export function effectiveRange(def: ParamDef, valueOf: (key: string) => number | undefined): RangeSpec {
  const by = def.rangeBy;
  const target = by ? valueOf(by.key) : undefined;
  const spec = by && target !== undefined ? by.ranges[target] : undefined;
  return spec ?? rangeOf(def);
}

/**
 * True if the app may write this parameter: never read-only ones (PLAN 4.4), and only addresses confirmed on
 * the amp (status C). Until an address is checked by writing and reading back, it stays read-only in the app.
 */
export function writable(def: ParamDef): boolean {
  return !def.readonly && def.status === 'C';
}

/** True if a VariantGroup parameter is shown for the given type (raw). */
export function visibleFor(def: ParamDef, type: number | undefined): boolean {
  return def.visibleFor === undefined || (type !== undefined && def.visibleFor.includes(type));
}

/** True if the showIf conditions of a parameter hold; `valueOf` gives the raw value of a sibling by key. */
export function shownWith(def: ParamDef, valueOf: (key: string) => number | undefined): boolean {
  return (def.showIf ?? []).every((c) => {
    const v = valueOf(c.key);
    return v !== undefined && c.values.includes(v);
  });
}

/** Byte length of an encoding. */
export function encodingSize(e: Encoding): number {
  switch (e) {
    case 'u7':
      return 1;
    case 'u4x4':
      return 4;
    case 'ascii16':
      return 16;
  }
}

/** The three variations ("colours") of an effect, by colour value 0–2. */
export type Instances = readonly [Address, Address, Address];

/**
 * An effect block that exists three times in the patch (PLAN 4.4: one template, several instances). Which
 * instance is active follows the colour byte of the effect.
 */
export interface VariantGroup {
  readonly key: 'booster' | 'mod' | 'fx' | 'delay' | 'reverb' | 'delay2';
  readonly label: string;
  /** On/off switch of the effect (patch parameter). */
  readonly switch: ParamDef;
  /** Colour = active variation 0–2 (patch parameter). */
  readonly colour: ParamDef;
  /** Block offset of each variation's type byte (byte 0 of that block). */
  readonly typeBlocks: Instances;
  /** Type names by raw value; empty until our own table exists (shown as "Type n"). */
  readonly typeNames: readonly string[];
  /** Block offset of each variation's parameter block (the type block itself for booster, delay and reverb). */
  readonly paramBlocks: Instances;
  /**
   * Parameters relative to the parameter block (byte 0 is the type for booster, delay and reverb). Mod and FX
   * share one list of all their types (modfx.ts). instanceParam() addresses them.
   */
  readonly params: readonly ParamDef[];
  readonly status: Status;
}

/**
 * A parameter of variation `colour` (0–2) as a patch parameter: offset from the patch base and a key with the
 * variation (`delay.1.time`). This is the form setValue and readRaw take.
 */
export function instanceParam(g: VariantGroup, colour: number, def: ParamDef): ParamDef {
  const base = g.paramBlocks[colour];
  if (base === undefined) throw new RangeError(`Bad colour ${colour}`);
  return { ...def, key: `${g.key}.${colour}.${def.key}`, at: base + def.at };
}
