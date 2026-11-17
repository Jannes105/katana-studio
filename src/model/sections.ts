// The parts of a patch outside the five effects with variations (protocol-notes 2.8, "Blocks for Phase 2"):
// chain, cabinet resonance and master key (block 02 00), contour type, solo, pedal FX, EQ 1 and EQ 2, send/return.
// Offsets, ranges, labels and value tables are our own table, taken from the local analysis of BOSS Tone Studio.
// Checked on the amp 2026-11-17 (-ParamTest -NoAsk -AllTypes): written, read back, no other byte changed,
// restored. Not in the list: the solo delay (3E 00). The block exists in every Gen 3 patch, but only the KATANA
// Artist uses it (BOSS Tone Studio hides it for the KATANA-100), and the amp ignored every write there.

import { addr, type Address } from '../protocol/address';
import type { ParamDef } from './schema';
import { EQ_FREQ, EQ_Q, HIGH_CUT, LOW_CUT, OFF_ON } from './tables';

/** Offset of a block inside the patch, written as in protocol-notes 2.12 (`b1 b2 00`). */
function blk(b1: number, b2: number): Address {
  return addr(0, b1, b2, 0);
}

type Rest = Partial<ParamDef> & Pick<ParamDef, 'control'>;

function u7(key: string, label: string, at: Address, rest: Rest): ParamDef {
  return { key, label, at, encoding: 'u7', min: 0, max: 100, status: 'C', ...rest };
}

const pick = (names: readonly string[], control: ParamDef['control'] = 'leds') =>
  ({ min: 0, max: names.length - 1, control, display: { table: names } }) as const;
const onOff = { ...pick(OFF_ON, 'switch') } as const;
/** A gain of ±n dB (raw = shown + n). */
const gain = (n: number) =>
  ({ min: 0, max: 2 * n, control: 'knob', display: { rawOffset: n, unit: 'dB' } }) as const;

export const SECTION_BLOCK = {
  other: blk(0x00, 0x02),
  soloCom: blk(0x00, 0x3a),
  soloEq: blk(0x00, 0x3c),
  pedalFxCom: blk(0x00, 0x48),
  pedalFx: blk(0x00, 0x4a),
  eqEach: [blk(0x00, 0x4c), blk(0x00, 0x4e)],
  eqPeq: [blk(0x00, 0x50), blk(0x00, 0x52)],
  eqGeq: [blk(0x00, 0x54), blk(0x00, 0x56)],
  sendReturn: blk(0x00, 0x5a),
} as const;

// ---- Block 02 00: chain variant, cabinet resonance, master key ----

/** Chain variant 0–8: where booster, mod, FX and delay sit relative to the amp (chain.ts). */
export const CHAIN_VARIANT = u7('chain.variant', 'Chain', SECTION_BLOCK.other + 0, {
  min: 0,
  max: 8,
  control: 'leds',
});
export const CABINET_RESONANCE = u7('amp.cabinetResonance', 'Cabinet Resonance', SECTION_BLOCK.other + 1, {
  ...pick(['Vintage', 'Modern', 'Deep']),
});
/** Key for the harmonist (mod or FX type HARMONIST). */
export const MASTER_KEY_NAMES = [
  'C (Am)',
  'Db (Bbm)',
  'D (Bm)',
  'Eb (Cm)',
  'E (C#m)',
  'F (Dm)',
  'F# (D#m)',
  'G (Em)',
  'Ab (Fm)',
  'A (F#m)',
  'Bb (Gm)',
  'B (G#m)',
] as const;
export const MASTER_KEY = u7('harmonist.masterKey', 'Master Key', SECTION_BLOCK.other + 2, {
  ...pick(MASTER_KEY_NAMES, 'knob'),
});

// ---- Contour type (byte 0 of each contour block; freq shift is byte 1, params.ts) ----

/** Type of contour 1–3, shown 1–4. */
export function contourType(contour: 1 | 2 | 3): ParamDef {
  return u7(`contour.${contour}.type`, 'Type', blk(0x00, 0x40 + 2 * contour), {
    min: 0,
    max: 3,
    control: 'leds',
    display: { rawOffset: -1 },
  });
}

// ---- Solo (3A 00 common, 3C 00 EQ; the solo delay 3E 00 is KATANA Artist only) ----

const AMP_IN_OUT = ['Amp In', 'Amp Out'] as const;
const SC = SECTION_BLOCK.soloCom,
  SE = SECTION_BLOCK.soloEq;

export const SOLO_PARAMS: readonly ParamDef[] = [
  u7('solo.on', 'Solo', SC + 0, onOff),
  u7('solo.level', 'Level', SC + 1, { control: 'knob' }),
  u7('solo.eq.position', 'Position', SE + 0, { ...pick(AMP_IN_OUT), group: 'EQ' }),
  u7('solo.eq.on', 'Solo EQ', SE + 1, { ...onOff, group: 'EQ' }),
  u7('solo.eq.lowCut', 'Low Cut', SE + 2, { ...pick(LOW_CUT, 'knob'), group: 'EQ' }),
  u7('solo.eq.lowGain', 'Low Gain', SE + 3, { ...gain(24), group: 'EQ' }),
  u7('solo.eq.midFreq', 'Mid Freq', SE + 4, { ...pick(EQ_FREQ, 'knob'), group: 'EQ' }),
  u7('solo.eq.midQ', 'Mid Q', SE + 5, { ...pick(EQ_Q, 'knob'), group: 'EQ' }),
  u7('solo.eq.midGain', 'Mid Gain', SE + 6, { ...gain(24), group: 'EQ' }),
  u7('solo.eq.highGain', 'High Gain', SE + 7, { ...gain(24), group: 'EQ' }),
  u7('solo.eq.highCut', 'High Cut', SE + 8, { ...pick(HIGH_CUT, 'knob'), group: 'EQ' }),
  u7('solo.eq.level', 'Level', SE + 9, { ...gain(24), group: 'EQ' }),
];

// ---- Pedal FX (48 00 common, 4A 00 parameters of all three types) ----

export const PEDAL_FX_TYPES = ['PEDAL WAH', 'PEDAL BEND', 'WAH 95E'] as const;
const PEDAL_WAH = 0,
  PEDAL_BEND = 1,
  WAH_95E = 2;
const PC = SECTION_BLOCK.pedalFxCom,
  PF = SECTION_BLOCK.pedalFx;

export const PEDAL_FX_TYPE = u7('pedalFx.type', 'Type', PC + 2, pick(PEDAL_FX_TYPES));

export const PEDAL_FX_PARAMS: readonly ParamDef[] = [
  u7('pedalFx.position', 'Position', PC + 0, pick(['Input', 'Post Amp'])),
  u7('pedalFx.on', 'Pedal FX', PC + 1, onOff),
  PEDAL_FX_TYPE,
  u7('pedalFx.pedalWah.wahType', 'Wah Type', PF + 0, {
    ...pick(['CRY WAH', 'VO WAH', 'FAT WAH', 'LIGHT WAH', '7STRING WAH', 'RESO WAH']),
    visibleFor: [PEDAL_WAH],
  }),
  u7('pedalFx.pedalWah.pedalPos', 'Pedal Pos', PF + 1, { control: 'knob', visibleFor: [PEDAL_WAH] }),
  u7('pedalFx.pedalWah.pedalMin', 'Pedal Min', PF + 2, { control: 'knob', visibleFor: [PEDAL_WAH] }),
  u7('pedalFx.pedalWah.pedalMax', 'Pedal Max', PF + 3, { control: 'knob', visibleFor: [PEDAL_WAH] }),
  u7('pedalFx.pedalWah.effectLevel', 'Effect Level', PF + 4, { control: 'knob', visibleFor: [PEDAL_WAH] }),
  u7('pedalFx.pedalWah.directMix', 'Direct Mix', PF + 5, { control: 'knob', visibleFor: [PEDAL_WAH] }),
  u7('pedalFx.pedalBend.pitch', 'Pitch', PF + 6, {
    min: 0,
    max: 48,
    control: 'knob',
    display: { rawOffset: 24 },
    visibleFor: [PEDAL_BEND],
  }),
  u7('pedalFx.pedalBend.pedalPos', 'Pedal Pos', PF + 7, { control: 'knob', visibleFor: [PEDAL_BEND] }),
  u7('pedalFx.pedalBend.effectLevel', 'Effect Level', PF + 8, { control: 'knob', visibleFor: [PEDAL_BEND] }),
  u7('pedalFx.pedalBend.directMix', 'Direct Mix', PF + 9, { control: 'knob', visibleFor: [PEDAL_BEND] }),
  u7('pedalFx.wah95e.pedalPos', 'Pedal Pos', PF + 10, { control: 'knob', visibleFor: [WAH_95E] }),
  u7('pedalFx.wah95e.pedalMin', 'Pedal Min', PF + 11, { control: 'knob', visibleFor: [WAH_95E] }),
  u7('pedalFx.wah95e.pedalMax', 'Pedal Max', PF + 12, { control: 'knob', visibleFor: [WAH_95E] }),
  u7('pedalFx.wah95e.effectLevel', 'Effect Level', PF + 13, { control: 'knob', visibleFor: [WAH_95E] }),
  u7('pedalFx.wah95e.directMix', 'Direct Mix', PF + 14, { control: 'knob', visibleFor: [WAH_95E] }),
];

// ---- EQ 1 and EQ 2 (4C/4E 00 common, 50/52 00 parametric, 54/56 00 graphic) ----

export const EQ_TYPES = ['PARAMETRIC EQ', 'GE-10'] as const;
const PEQ = 0,
  GEQ = 1;
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

/** The type parameter of EQ 1 or EQ 2 (visibleFor of its parameters refers to it). */
export function eqType(n: 1 | 2): ParamDef {
  return u7(`eq${n}.type`, 'Type', SECTION_BLOCK.eqEach[(n - 1) as 0 | 1] + 2, pick(EQ_TYPES));
}

function eqParams(n: 1 | 2): ParamDef[] {
  const each = SECTION_BLOCK.eqEach[(n - 1) as 0 | 1],
    p = SECTION_BLOCK.eqPeq[(n - 1) as 0 | 1],
    g = SECTION_BLOCK.eqGeq[(n - 1) as 0 | 1];
  const peq = (key: string, label: string, byte: number, rest: Rest): ParamDef =>
    u7(`eq${n}.peq.${key}`, label, p + byte, { ...rest, visibleFor: [PEQ] });
  return [
    u7(`eq${n}.position`, 'Position', each + 0, pick(AMP_IN_OUT)),
    u7(`eq${n}.on`, `EQ ${n}`, each + 1, onOff),
    eqType(n),
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
      u7(`eq${n}.geq.${i < 10 ? `band${i + 1}` : 'level'}`, label, g + i, { ...gain(24), visibleFor: [GEQ] }),
    ),
  ];
}

export const EQ_PARAMS: readonly ParamDef[] = [...eqParams(1), ...eqParams(2)];

// ---- Send/return (5A 00) ----

const SR = SECTION_BLOCK.sendReturn;

export const SEND_RETURN_PARAMS: readonly ParamDef[] = [
  u7('sendReturn.on', 'Send/Return', SR + 0, onOff),
  u7('sendReturn.position', 'Position', SR + 1, pick(['Post FV', 'Post Rev', 'Pre FV'])),
  u7('sendReturn.mode', 'Mode', SR + 2, pick(['Series', 'Parallel'])),
  u7('sendReturn.sendLevel', 'Send Level', SR + 3, { control: 'knob' }),
  u7('sendReturn.returnLevel', 'Return Level', SR + 4, { control: 'knob' }),
];

/** Every parameter of this file, for the list of patch parameters. */
export const SECTION_PARAMS: readonly ParamDef[] = [
  CHAIN_VARIANT,
  CABINET_RESONANCE,
  MASTER_KEY,
  contourType(1),
  contourType(2),
  contourType(3),
  ...SOLO_PARAMS,
  ...PEDAL_FX_PARAMS,
  ...EQ_PARAMS,
  ...SEND_RETURN_PARAMS,
];

// ---- The sections as units for the effects tab and its pages (PLAN 5, Phase 2 PR 3) ----

export type SectionKey = 'pedalFx' | 'eq1' | 'eq2' | 'sendReturn' | 'solo';

/** One section: its on/off switch, the parameter whose value picks what is shown (visibleFor), the rest. */
export interface Section {
  readonly key: SectionKey;
  readonly label: string;
  readonly switch: ParamDef;
  /** Type (pedal FX, EQ): visibleFor of the other parameters refers to it. */
  readonly type?: ParamDef;
  /** Position in the chain (chain.ts), if the section has one. */
  readonly position?: ParamDef;
  /** Everything else in display order, the switch excluded (type and position are among them). */
  readonly params: readonly ParamDef[];
}

const byKey = (list: readonly ParamDef[], key: string): ParamDef => {
  const p = list.find((q) => q.key === key);
  if (!p) throw new Error(`No parameter ${key}`);
  return p;
};

function section(
  key: SectionKey,
  label: string,
  list: readonly ParamDef[],
  extra: { type?: string; position?: string } = {},
): Section {
  const sw = byKey(list, `${key}.on`);
  return {
    key,
    label,
    switch: sw,
    ...(extra.type ? { type: byKey(list, extra.type) } : {}),
    ...(extra.position ? { position: byKey(list, extra.position) } : {}),
    params: list.filter((p) => p !== sw),
  };
}

const eqList = (n: 1 | 2) => EQ_PARAMS.filter((p) => p.key.startsWith(`eq${n}.`));

export const SECTIONS: readonly Section[] = [
  section('pedalFx', 'Pedal FX', PEDAL_FX_PARAMS, { type: 'pedalFx.type', position: 'pedalFx.position' }),
  section('eq1', 'EQ 1', eqList(1), { type: 'eq1.type', position: 'eq1.position' }),
  section('eq2', 'EQ 2', eqList(2), { type: 'eq2.type', position: 'eq2.position' }),
  section('sendReturn', 'Send/Return', SEND_RETURN_PARAMS, { position: 'sendReturn.position' }),
  section('solo', 'Solo', SOLO_PARAMS),
];

export function sectionByKey(key: SectionKey): Section {
  const s = SECTIONS.find((x) => x.key === key);
  if (!s) throw new Error(`No section ${key}`);
  return s;
}
