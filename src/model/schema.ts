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
  readonly status: Status;
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
  /** Parameters relative to the parameter block; filled from Phase 1b on. */
  readonly params: readonly ParamDef[];
  readonly status: Status;
}
