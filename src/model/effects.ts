// Type names and the parameters inside a variation of booster, delay and reverb (PLAN 4.4). Kept apart from
// params.ts so that other lists (assigns.ts) can use them as targets without an import cycle.

import { addr, type Address } from '../protocol/address';
import type { ParamDef } from './schema';
import { HIGH_CUT, LOW_CUT, NORMAL_INVERSE, OFF_ON } from './tables';

/** Offset of a block inside the patch, written as in protocol-notes 2.12 (`b1 b2 00`). */
function blk(b1: number, b2: number): Address {
  return addr(0, b1, b2, 0);
}

const PERCENT = { min: 0, max: 100 } as const;

function u7(
  key: string,
  label: string,
  at: Address,
  rest: Partial<ParamDef> & Pick<ParamDef, 'status' | 'control'>,
): ParamDef {
  return { key, label, at, encoding: 'u7', min: 0, max: 127, ...rest };
}

// Type names by raw value (our own tables; protocol-notes 2.8). Mod and FX choose from the same list.
export const BOOSTER_TYPES = [
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
export const MOD_FX_TYPES = [
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
export const DELAY_TYPES = [
  'DIGITAL',
  'PAN',
  'STEREO',
  'ANALOG',
  'TAPE ECHO',
  'REVERSE',
  'MODULATE',
  'SDE-3000',
] as const;
export const REVERB_TYPES = ['PLATE', 'ROOM', 'HALL', 'SPRING', 'MODULATE'] as const;

// ---- Parameters of one variation (relative to its block; byte 0 is the type) ----
// Layout and ranges from the local analysis of BOSS Tone Studio, which parameter shows for which type from its
// effect pages (PLAN 5, slice 5 of 1a: names and positions only). Checked on the amp 2026-11-16 (write, read back, no other byte changed).

/** A knob or switch inside a variation block. */
function inst(
  key: string,
  label: string,
  byte: number,
  rest: Partial<ParamDef> & Pick<ParamDef, 'control'>,
): ParamDef {
  return u7(key, label, byte, { ...PERCENT, status: 'C', ...rest });
}

/** A time in ms as four nibbles (u4x4) inside a variation block. */
function ms(key: string, label: string, byte: number, min: number, max: number, dragStep: number): ParamDef {
  return {
    key,
    label,
    at: byte,
    encoding: 'u4x4',
    min,
    max,
    control: 'knob',
    display: { unit: 'ms' },
    dragStep,
    status: 'C',
  };
}

const table = (
  names: readonly string[],
  control: ParamDef['control'] = 'leds',
): Partial<ParamDef> & Pick<ParamDef, 'control'> => ({
  min: 0,
  max: names.length - 1,
  control,
  display: { table: names },
});

/** Booster block (8 bytes), the same for every type. */
export const BOOSTER_PARAMS: readonly ParamDef[] = [
  inst('drive', 'Drive', 1, { max: 120, control: 'knob' }),
  inst('bottom', 'Bottom', 2, { control: 'knob', display: { rawOffset: 50 } }),
  inst('tone', 'Tone', 3, { control: 'knob', display: { rawOffset: 50 } }),
  inst('solo', 'Solo', 4, table(OFF_ON, 'switch')),
  inst('soloLevel', 'Solo Level', 5, { control: 'knob' }),
  inst('effectLevel', 'Effect Level', 6, { control: 'knob' }),
  inst('directMix', 'Direct Mix', 7, { control: 'knob' }),
];

/** Delay type values (index into DELAY_TYPES) that pick a page with extra parameters. */
const DELAY_PAN = 1;
const DELAY_MODULATE = 6;
const DELAY_SDE3000 = 7;

/** Delay block (17 bytes). BOSS Tone Studio has four pages: standard, PAN, MODULATE and SDE-3000. */
export const DELAY_PARAMS: readonly ParamDef[] = [
  ms('time', 'Time', 1, 1, 2000, 5),
  inst('feedback', 'Feedback', 5, { control: 'knob' }),
  inst('highCut', 'High Cut', 6, {
    ...table(HIGH_CUT, 'knob'),
    visibleFor: [0, 1, 2, 3, 4, 5, 6], // not SDE-3000
  }),
  inst('effectLevel', 'Effect Level', 7, { max: 120, control: 'knob' }),
  inst('directMix', 'Direct Mix', 8, { control: 'knob' }),
  inst('tapTime', 'Tap Time', 9, { control: 'knob', display: { unit: '%' }, visibleFor: [DELAY_PAN] }),
  inst('modRate', 'Mod Rate', 10, { control: 'knob', visibleFor: [DELAY_MODULATE, DELAY_SDE3000] }),
  inst('modDepth', 'Mod Depth', 11, { control: 'knob', visibleFor: [DELAY_MODULATE, DELAY_SDE3000] }),
  // Called LPF in the address map, "Range" on the SDE-3000 page with the names 8 kHz / 17 kHz.
  inst('range', 'Range', 12, { ...table(['8 kHz', '17 kHz']), visibleFor: [DELAY_SDE3000] }),
  inst('filter', 'Filter', 13, { ...table(OFF_ON, 'switch'), visibleFor: [DELAY_SDE3000] }),
  inst('feedbackPhase', 'Feedback Phase', 14, { ...table(NORMAL_INVERSE), visibleFor: [DELAY_SDE3000] }),
  inst('delayPhase', 'Delay Phase', 15, { ...table(NORMAL_INVERSE), visibleFor: [DELAY_SDE3000] }),
  inst('modSwitch', 'Mod', 16, { ...table(OFF_ON, 'switch'), visibleFor: [DELAY_SDE3000] }),
];

const REVERB_SPRING = 3;

/** Reverb block (13 bytes). Byte 1 is the layer mode: Delay 2 only, both, or reverb only (Phase 2). */
export const REVERB_PARAMS: readonly ParamDef[] = [
  // The amp keeps layer mode and the Delay 2 switch (08 00 + 4) consistent: writing one changes the other.
  inst('layerMode', 'Layer Mode', 1, {
    ...table(['Delay 2', 'Both', 'Reverb']),
    alsoChanges: [blk(0x00, 0x08) + 4],
  }),
  // Shown 0.1–10.0 s as in BOSS Tone Studio (raw 0–99 = 0.1 s steps).
  inst('time', 'Time', 2, {
    max: 99,
    control: 'knob',
    display: { rawOffset: -1, factor: 0.1, decimals: 1, unit: 's' },
  }),
  ms('preDelay', 'Pre Delay', 3, 0, 500, 1),
  inst('lowCut', 'Low Cut', 7, table(LOW_CUT, 'knob')),
  inst('highCut', 'High Cut', 8, table(HIGH_CUT, 'knob')),
  inst('density', 'Density', 9, { max: 10, control: 'knob' }),
  inst('effectLevel', 'Effect Level', 10, { control: 'knob' }),
  inst('directMix', 'Direct Mix', 11, { control: 'knob' }),
  inst('springColor', 'Spring Color', 12, { control: 'knob', visibleFor: [REVERB_SPRING] }),
];
