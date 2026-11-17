// SYSTEM (PLAN 5, Phase 3): settings for the whole amp, not stored in a patch (protocol-notes 2.6, "SYSTEM").
// Offsets are linear from the SYSTEM base `10 00 00 00`; 21 blocks, one every `02 00`. Layout, ranges and value
// names from the local analysis of BOSS Tone Studio; our own table. Not in the list: stereo expand (block
// `00 00`, BOSS Tone Studio shows no control for it) and power control (block `20 00`, hidden for the KATANA-100
// by its model table). Both stay raw in backups.

import { addr, type Address } from '../protocol/address';
import { GAFC_FS_FUNCTIONS } from './assigns';
import type { ParamDef, Status } from './schema';
import { EQ_TYPES } from './sections';
import { EQ_FREQ, EQ_Q, HIGH_CUT, LOW_CUT, OFF_ON } from './tables';

/** Offset of SYSTEM block `n` (0–20) from the SYSTEM base. */
const blk = (n: number): Address => n * addr(0, 0, 0x02, 0);

export const SYSTEM_BLOCK = {
  usb: blk(1),
  globalCom: blk(2),
  globalEach: [blk(3), blk(4), blk(5)],
  globalPeq: [blk(6), blk(7), blk(8)],
  globalGeq: [blk(9), blk(10), blk(11)],
  lineOutCom: blk(12),
  lineOut: [blk(13), blk(14)],
  powerAmpIn: blk(15),
  gafc: blk(17),
  midiCom: blk(18),
  midiCc: blk(19),
  midiPc: blk(20),
} as const;

// Every address was checked on the amp 2026-11-17 (-ParamTest -System -NoAsk: written, read back, no other SYSTEM byte
// changed, restored; protocol-notes 2.6). A write is kept over a power cycle without any save command.
const STATUS: Status = 'C';

type Rest = Partial<ParamDef> & Pick<ParamDef, 'control'>;

function u7(key: string, label: string, at: Address, rest: Rest): ParamDef {
  return { key: `system.${key}`, label, at, encoding: 'u7', min: 0, max: 100, status: STATUS, ...rest };
}
const pick = (names: readonly string[], control: ParamDef['control'] = 'leds') =>
  ({ min: 0, max: names.length - 1, control, display: { table: names } }) as const;
/** A gain of ±n dB (raw = shown + n). */
const gain = (n: number) =>
  ({ min: 0, max: 2 * n, control: 'knob', display: { rawOffset: n, unit: 'dB' } }) as const;
/** 0–100 shown as 0–200 % (USB levels). */
const percent2 = { control: 'knob', display: { factor: 2, unit: '%' } } as const;

// ---- USB (block 02 00) ----

const U = SYSTEM_BLOCK.usb;
export const USB_PARAMS: readonly ParamDef[] = [
  u7('usb.inputLevel', 'To Effect Level', U + 0, gain(20)),
  u7('usb.outLevel', 'Effect Out Level', U + 1, percent2),
  u7('usb.mixLevel', 'Mix Level', U + 2, percent2),
  u7('usb.loopback', 'Loop Back', U + 3, pick(OFF_ON, 'switch')),
  u7('usb.dryOutLevel', 'Dry Out Level', U + 4, percent2),
];

// ---- Global EQ (04 00 common; three memories: 06–0A 00 position/type, 0C–10 00 PEQ, 12–16 00 GE-10) ----

export const GLOBAL_EQ_POSITIONS = ['INPUT', 'OUTPUT', 'LINE OUT', 'SP OUT'] as const;
const GEQ_BANDS = [
  '31 Hz',
  '62 Hz',
  '125 Hz',
  '250 Hz',
  '500 Hz',
  '1 kHz',
  '2 kHz',
  '4 kHz',
  '8 kHz',
  '16 kHz',
];

export const GLOBAL_EQ_SWITCH = u7(
  'globalEq.on',
  'Global EQ',
  SYSTEM_BLOCK.globalCom + 0,
  pick(OFF_ON, 'switch'),
);
export const GLOBAL_EQ_SELECT = u7(
  'globalEq.select',
  'Memory',
  SYSTEM_BLOCK.globalCom + 1,
  pick(['1', '2', '3']),
);

/** Type of global EQ memory m (1–3); visibleFor of its PEQ and GE-10 parameters refers to it. */
export function globalEqType(m: 1 | 2 | 3): ParamDef {
  return u7(`globalEq.${m}.type`, 'Type', SYSTEM_BLOCK.globalEach[(m - 1) as 0 | 1 | 2] + 1, pick(EQ_TYPES));
}

function globalEqMemory(m: 1 | 2 | 3): ParamDef[] {
  const each = SYSTEM_BLOCK.globalEach[(m - 1) as 0 | 1 | 2],
    p = SYSTEM_BLOCK.globalPeq[(m - 1) as 0 | 1 | 2],
    g = SYSTEM_BLOCK.globalGeq[(m - 1) as 0 | 1 | 2];
  const peq = (key: string, label: string, byte: number, rest: Rest): ParamDef =>
    u7(`globalEq.${m}.peq.${key}`, label, p + byte, { ...rest, visibleFor: [0] });
  return [
    u7(`globalEq.${m}.position`, 'Position', each + 0, pick(GLOBAL_EQ_POSITIONS)),
    globalEqType(m),
    peq('lowCut', 'Low Cut', 0, pick(LOW_CUT, 'knob')),
    peq('lowGain', 'Low Gain', 1, gain(20)),
    peq('lowMidFreq', 'Low-Mid Freq', 2, pick(EQ_FREQ, 'knob')),
    peq('lowMidQ', 'Low-Mid Q', 3, pick(EQ_Q, 'knob')),
    peq('lowMidGain', 'Low-Mid Gain', 4, gain(20)),
    peq('highMidFreq', 'High-Mid Freq', 5, pick(EQ_FREQ, 'knob')),
    peq('highMidQ', 'High-Mid Q', 6, pick(EQ_Q, 'knob')),
    peq('highMidGain', 'High-Mid Gain', 7, gain(20)),
    peq('highGain', 'High Gain', 8, gain(20)),
    peq('highCut', 'High Cut', 9, pick(HIGH_CUT, 'knob')),
    peq('level', 'Level', 10, gain(20)),
    ...[...GEQ_BANDS, 'Level'].map((label, i) =>
      u7(`globalEq.${m}.geq.${i < 10 ? `band${i + 1}` : 'level'}`, label, g + i, {
        ...gain(24),
        visibleFor: [1],
      }),
    ),
  ];
}

export const GLOBAL_EQ_PARAMS: readonly ParamDef[] = [
  GLOBAL_EQ_SWITCH,
  GLOBAL_EQ_SELECT,
  ...globalEqMemory(1),
  ...globalEqMemory(2),
  ...globalEqMemory(3),
];

// ---- Line out (18 00 common; 1A 00, 1C 00 custom memories M1/M2) ----

/** Air feel mode by raw value (BOSS Tone Studio lists REC, BLEND, LIVE). */
export const AIR_FEEL_MODES = ['REC', 'LIVE', 'BLEND'] as const;
export const MIC_TYPES = ['DYN57', 'DYN421', 'CND451', 'CND87', 'RBN121'] as const;

const LC = SYSTEM_BLOCK.lineOutCom;
export const LINE_OUT_PARAMS: readonly ParamDef[] = [
  u7('lineOut.airFeel', 'Air Feel', LC + 1, pick(AIR_FEEL_MODES)),
  u7('lineOut.custom', 'Custom', LC + 2, pick(OFF_ON, 'switch')),
  u7('lineOut.select', 'Custom Memory', LC + 0, pick(['M1', 'M2'])),
  ...([1, 2] as const).flatMap((n) => {
    const b = SYSTEM_BLOCK.lineOut[(n - 1) as 0 | 1];
    const group = `M${n}`;
    return [
      u7(`lineOut.m${n}.micType`, 'Mic Type', b + 0, { ...pick(MIC_TYPES), group }),
      u7(`lineOut.m${n}.micDistance`, 'Mic Distance', b + 1, {
        max: 20,
        control: 'knob',
        display: { unit: 'cm' },
        group,
      }),
      u7(`lineOut.m${n}.micPosition`, 'Mic Position', b + 2, {
        max: 10,
        control: 'knob',
        display: { unit: 'cm' },
        group,
      }),
      u7(`lineOut.m${n}.ambiencePreDelay`, 'Ambience Pre-Delay', b + 3, { control: 'knob', group }),
      u7(`lineOut.m${n}.ambienceLevel`, 'Ambience Level', b + 4, { control: 'knob', group }),
    ];
  }),
];

// ---- Power amp in (1E 00) ----

export const HPF_TYPES = ['FLAT', '-6 dB/oct', '-12 dB/oct', '-18 dB/oct', '-24 dB/oct'] as const;

const PA = SYSTEM_BLOCK.powerAmpIn;
export const POWER_AMP_IN_PARAMS: readonly ParamDef[] = [
  u7('powerAmpIn.hpfType', 'HPF Type', PA + 0, pick(HPF_TYPES, 'knob')),
  // Shown 1–100 Hz (raw = shown − 1).
  u7('powerAmpIn.hpfFreq', 'HPF Freq', PA + 1, {
    max: 99,
    control: 'knob',
    display: { rawOffset: -1, unit: 'Hz' },
  }),
  u7('powerAmpIn.level', 'Level', PA + 2, gain(20)),
];

// ---- GA-FC function mode (22 00): SW1–4 and PANEL while EFFECT is held (protocol-notes 2.8, GA-FC capture) ----

export const GAFC_SYSTEM_PARAMS: readonly ParamDef[] = ['SW1', 'SW2', 'SW3', 'SW4', 'PANEL'].map((label, i) =>
  u7(`gafc.${label.toLowerCase()}`, label, SYSTEM_BLOCK.gafc + i, pick(GAFC_FS_FUNCTIONS)),
);

// ---- MIDI (24 00 channel, 26 00 control change numbers, 28 00 program change numbers) ----

/** MIDI CC numbers by raw value: CC#1–31, then CC#64–95. */
export const MIDI_CC_NUMBERS: readonly string[] = [
  ...Array.from({ length: 31 }, (_, i) => `CC#${i + 1}`),
  ...Array.from({ length: 32 }, (_, i) => `CC#${i + 64}`),
];
const CC_TARGETS = [
  ['booster', 'Booster'],
  ['mod', 'Mod'],
  ['fx', 'FX'],
  ['delay', 'Delay'],
  ['reverb', 'Reverb'],
  ['sendReturn', 'Send/Return'],
  ['expPedal', 'EXP Pedal'],
  ['gafcExp1', 'GA-FC EXP 1'],
  ['gafcExp2', 'GA-FC EXP 2'],
  ['gafcExp3', 'GA-FC EXP 3'],
  ['gafcFs1', 'GA-FC FS1'],
  ['gafcFs2', 'GA-FC FS2'],
  ['gafcFs3', 'GA-FC FS3'],
  ['gafcExpandExp1', 'GA-FC Expand EXP 1'],
  ['gafcExpandExp2', 'GA-FC Expand EXP 2'],
  ['gafcExpandExp3', 'GA-FC Expand EXP 3'],
  ['gafcExpandFs1', 'GA-FC Expand FS1'],
  ['gafcExpandFs2', 'GA-FC Expand FS2'],
  ['gafcExpandFs3', 'GA-FC Expand FS3'],
] as const;
const PC_TARGETS = ['PANEL', 'A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'] as const;

export const MIDI_PARAMS: readonly ParamDef[] = [
  u7('midi.channel', 'Rx Channel', SYSTEM_BLOCK.midiCom + 0, {
    ...pick(Array.from({ length: 16 }, (_, i) => `Ch.${i + 1}`)),
  }),
  ...CC_TARGETS.map(([key, label], i) =>
    u7(`midi.cc.${key}`, label, SYSTEM_BLOCK.midiCc + i, { ...pick(MIDI_CC_NUMBERS), group: 'CC' }),
  ),
  ...PC_TARGETS.map((label, i) =>
    u7(`midi.pc.${label.toLowerCase()}`, label, SYSTEM_BLOCK.midiPc + i, {
      min: 0,
      max: 127,
      control: 'knob',
      // Program change numbers 1–128 (raw = shown − 1).
      display: { rawOffset: -1 },
      group: 'PC',
    }),
  ),
];

/** Every SYSTEM parameter of the list (offsets from the SYSTEM base). */
export const SYSTEM_PARAMS: readonly ParamDef[] = [
  ...USB_PARAMS,
  ...GLOBAL_EQ_PARAMS,
  ...LINE_OUT_PARAMS,
  ...POWER_AMP_IN_PARAMS,
  ...GAFC_SYSTEM_PARAMS,
  ...MIDI_PARAMS,
];
