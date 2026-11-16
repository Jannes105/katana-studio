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
  /** Raw steps per drag step of a knob (e.g. 5 for the delay time in ms); default 1. */
  readonly dragStep?: number;
  readonly status: Status;
}

/**
 * True if the app may write this parameter: never read-only ones (PLAN 4.4), and only addresses confirmed on
 * the amp (status C). Until an address is checked by writing and reading back, it stays read-only in the app.
 */
export function writable(def: ParamDef): boolean {
  return !def.readonly && def.status === 'C' && def.encoding !== 'ascii16';
}

/** True if a VariantGroup parameter is shown for the given type (raw). */
export function visibleFor(def: ParamDef, type: number | undefined): boolean {
  return def.visibleFor === undefined || (type !== undefined && def.visibleFor.includes(type));
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
  readonly key: 'booster' | 'mod' | 'fx' | 'delay' | 'reverb';
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
   * Parameters relative to the parameter block (byte 0 is the type for booster, delay and reverb). Filled for
   * booster, delay and reverb (Phase 1b); mod and FX follow in Phase 2. instanceParam() addresses them.
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
