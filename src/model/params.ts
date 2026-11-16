// Our own parameter list (PLAN 4.4), so far for what Phase 1a shows: patch name, amp with type, variations and
// resonance, contour, the five effects with on/off, active variation and its type, and the noise suppressor.
// Offsets and status as in protocol-notes 2.8; everything marked 'D' still needs a check on the amp.

import { addr, type Address } from '../protocol/address';
import type { Instances, ParamDef, VariantGroup } from './schema';

/** Model and date of the last check against the amp (PLAN 4.4: version reference). */
export const PARAM_LIST_INFO = { model: 'KATANA-100 Gen 3', modelCode: 0x06, checked: '2026-11-15' } as const;

/** Offset of a block inside the patch, written as in protocol-notes 2.12 (`b1 b2 00`). */
function blk(b1: number, b2: number): Address {
  return addr(0, b1, b2, 0);
}

export const BLOCK = {
  name: blk(0x00, 0x00),
  colours: blk(0x00, 0x04),
  amp: blk(0x00, 0x06),
  switches: blk(0x00, 0x08),
  ns: blk(0x00, 0x58),
} as const;

const PERCENT = { min: 0, max: 100 } as const;

function u7(
  key: string,
  label: string,
  at: Address,
  rest: Partial<ParamDef> & Pick<ParamDef, 'status' | 'control'>,
): ParamDef {
  return { key, label, at, encoding: 'u7', min: 0, max: 127, ...rest };
}

export const PATCH_NAME: ParamDef = {
  key: 'patch.name',
  label: 'Name',
  at: BLOCK.name,
  encoding: 'ascii16',
  min: 32,
  max: 125,
  control: 'text',
  status: 'C',
};

// ---- Amp (block 06 00, 10 bytes) ----

/** Raw value 0–5 of the amp type (order from the stored slots and their names and from analysis, protocol-notes 2.8). */
export const AMP_TYPE_NAMES = ['Acoustic', 'Clean', 'Pushed', 'Crunch', 'Lead', 'Brown'] as const;

const ampKnob = (key: string, label: string, byte: number): ParamDef =>
  u7(`amp.${key}`, label, BLOCK.amp + byte, { ...PERCENT, control: 'knob', rehearsal: true, status: 'C' });

export const AMP_GAIN = ampKnob('gain', 'Gain', 0);
export const AMP_VOLUME = ampKnob('volume', 'Volume', 1);
export const AMP_BASS = ampKnob('bass', 'Bass', 2);
export const AMP_MIDDLE = ampKnob('middle', 'Middle', 3);
export const AMP_TREBLE = ampKnob('treble', 'Treble', 4);
export const AMP_PRESENCE = ampKnob('presence', 'Presence', 5);
export const AMP_POWERAMP_VARIATION = u7('amp.powerampVariation', 'Power Amp Variation', BLOCK.amp + 6, {
  min: 0,
  max: 1,
  control: 'switch',
  status: 'D',
});
export const AMP_TYPE = u7('amp.type', 'Type', BLOCK.amp + 7, {
  min: 0,
  max: AMP_TYPE_NAMES.length - 1,
  control: 'leds',
  display: { table: AMP_TYPE_NAMES },
  rehearsal: true,
  status: 'D',
});
export const AMP_RESONANCE = u7('amp.resonance', 'Resonance', BLOCK.amp + 8, {
  ...PERCENT,
  control: 'knob',
  status: 'D',
});
export const AMP_VARIATION = u7('amp.variation', 'Variation', BLOCK.amp + 9, {
  min: 0,
  max: 1,
  control: 'switch',
  rehearsal: true,
  status: 'D',
});

export const AMP_KNOBS: readonly ParamDef[] = [
  AMP_GAIN,
  AMP_VOLUME,
  AMP_BASS,
  AMP_MIDDLE,
  AMP_TREBLE,
  AMP_PRESENCE,
];

// ---- Noise suppressor (block 58 00, 3 bytes) ----

export const NS_SWITCH = u7('ns.on', 'Noise Suppressor', BLOCK.ns + 0, {
  min: 0,
  max: 1,
  control: 'switch',
  status: 'D',
});
export const NS_THRESHOLD = u7('ns.threshold', 'Threshold', BLOCK.ns + 1, {
  ...PERCENT,
  control: 'knob',
  rehearsal: true,
  status: 'C',
});
export const NS_RELEASE = u7('ns.release', 'Release', BLOCK.ns + 2, {
  ...PERCENT,
  control: 'knob',
  rehearsal: true,
  status: 'D',
});

// ---- Contour (block 40 00 selects, one 2-byte block per contour at 42 00, 44 00, 46 00) ----

export const CONTOUR_NAMES = ['Off', '1', '2', '3'] as const;

export const CONTOUR_SELECT = u7('contour.select', 'Contour', blk(0x00, 0x40), {
  min: 0,
  max: CONTOUR_NAMES.length - 1,
  control: 'leds',
  display: { table: CONTOUR_NAMES },
  status: 'D',
});

/** Freq Shift of contour 1–3 (-50…+50, raw = shown + 50). */
export function contourFreqShift(contour: 1 | 2 | 3): ParamDef {
  return u7(`contour.${contour}.freqShift`, 'Freq Shift', blk(0x00, 0x40 + 2 * contour) + 1, {
    min: 0,
    max: 100,
    control: 'knob',
    display: { rawOffset: 50 },
    status: 'D',
  });
}

// ---- Effects with three variations (PLAN 4.4) ----

// Type names by raw value (our own tables; protocol-notes 2.8). Mod and FX choose from the same list.
const BOOSTER_TYPES = [
  'MID BOOST',
  'CLEAN BOOST',
  'TREBLE BOOST',
  'CRUNCH OD',
  'NATURAL OD',
  'WARM OD',
  'FAT DS',
  'METAL DS',
  'OCT FUZZ',
  'BLUES DRIVE',
  'OVERDRIVE',
  'T-SCREAM',
  'TURBO OD',
  'DISTORTION',
  'RAT',
  'GUV DS',
  'DST+',
  'METAL ZONE',
  "'60S FUZZ",
  'MUFF FUZZ',
  'HM-2',
  'METAL CORE',
  'CENTA OD',
] as const;
const MOD_FX_TYPES = [
  'T.WAH',
  'AUTO WAH',
  'PEDAL WAH',
  'COMP',
  'LIMITER',
  'GRAPHIC EQ',
  'PARAMETRIC EQ',
  'GUITAR SIM',
  'SLOW GEAR',
  'WAVE SYNTH',
  'OCTAVE',
  'PITCH SHIFTER',
  'HARMONIST',
  'AC.PROCESSOR',
  'PHASER',
  'FLANGER',
  'TREMOLO',
  'ROTARY',
  'UNI-V',
  'SLICER',
  'VIBRATO',
  'RING MOD',
  'HUMANIZER',
  'CHORUS',
  'AC.GUITAR SIM',
  'PHASER 90E',
  'FLANGER 117E',
  'WAH 95E',
  'DC-30',
  'HEAVY OCTAVE',
  'PEDAL BEND',
] as const;
const DELAY_TYPES = [
  'DIGITAL',
  'PAN',
  'STEREO',
  'ANALOG',
  'TAPE ECHO',
  'REVERSE',
  'MODULATE',
  'SDE-3000',
] as const;
const REVERB_TYPES = ['PLATE', 'ROOM', 'HALL', 'SPRING', 'MODULATE'] as const;

const colour = (key: string, label: string, byte: number): ParamDef =>
  u7(`${key}.colour`, `${label} Variation`, BLOCK.colours + byte, {
    min: 0,
    max: 2,
    control: 'leds',
    status: 'C',
  });

const onOff = (key: string, label: string, byte: number, status: 'C' | 'D' = 'C'): ParamDef =>
  u7(`${key}.on`, label, BLOCK.switches + byte, { min: 0, max: 1, control: 'switch', status });

/** Three blocks every 02 00 from `b1 b2 00`. */
function three(b1: number, b2: number): Instances {
  const first = blk(b1, b2);
  const step = blk(0x00, 0x02);
  return [first, first + step, first + 2 * step];
}

function group(
  key: VariantGroup['key'],
  label: string,
  byte: { colour: number; switch: number },
  typeNames: readonly string[],
  typeBlocks: Instances,
  paramBlocks: Instances = typeBlocks,
): VariantGroup {
  return {
    key,
    label,
    switch: onOff(key, label, byte.switch),
    colour: colour(key, label, byte.colour),
    typeBlocks,
    typeNames,
    paramBlocks,
    params: [],
    // Switch and colour are confirmed; the instance blocks are derived (stored slots, knob reports Q3).
    status: 'D',
  };
}

export const EFFECTS: readonly VariantGroup[] = [
  group('booster', 'Booster', { colour: 0, switch: 0 }, BOOSTER_TYPES, three(0x00, 0x0a)),
  group('mod', 'Mod', { colour: 1, switch: 1 }, MOD_FX_TYPES, three(0x00, 0x10), three(0x00, 0x1c)),
  group('fx', 'FX', { colour: 2, switch: 2 }, MOD_FX_TYPES, three(0x00, 0x16), three(0x00, 0x22)),
  group('delay', 'Delay', { colour: 3, switch: 3 }, DELAY_TYPES, three(0x00, 0x28)),
  // The reverb switch is byte 5; byte 4 is the Delay 2 switch (protocol-notes Q3).
  group('reverb', 'Reverb', { colour: 4, switch: 5 }, REVERB_TYPES, three(0x00, 0x34)),
];

/** Delay 2 switch (hangs on the reverb variation and its layer mode, PLAN 4.4). Not shown before Phase 2. */
export const DELAY2_SWITCH = onOff('delay2', 'Delay 2', 4, 'D');

/** The type byte of variation `colour` of an effect, as a parameter. */
export function effectType(g: VariantGroup, colourValue: number): ParamDef {
  const at = g.typeBlocks[colourValue];
  if (at === undefined) throw new RangeError(`Bad colour ${colourValue}`);
  return {
    key: `${g.key}.${colourValue}.type`,
    label: 'Type',
    at,
    encoding: 'u7',
    min: 0,
    max: g.typeNames.length > 0 ? g.typeNames.length - 1 : 127,
    control: 'leds',
    display: { table: g.typeNames },
    // Writable only once the table of names exists (otherwise the range is unknown).
    readonly: g.typeNames.length === 0,
    status: 'D',
  };
}

/** Every patch parameter of the list (variation parameters excluded), for checks and lookups. */
export const PATCH_PARAMS: readonly ParamDef[] = [
  PATCH_NAME,
  ...AMP_KNOBS,
  AMP_TYPE,
  AMP_RESONANCE,
  AMP_VARIATION,
  AMP_POWERAMP_VARIATION,
  NS_SWITCH,
  NS_THRESHOLD,
  NS_RELEASE,
  CONTOUR_SELECT,
  contourFreqShift(1),
  contourFreqShift(2),
  contourFreqShift(3),
  ...EFFECTS.flatMap((g) => [g.switch, g.colour, effectType(g, 0), effectType(g, 1), effectType(g, 2)]),
  DELAY2_SWITCH,
];
