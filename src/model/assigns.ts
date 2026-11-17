// Assigns (PLAN 5, Phase 3): what the effect knobs on the amp, the expression pedal and footswitch on the amp, and
// the GA-FC (three footswitches, three expression inputs) control in a patch. Layout from the local analysis of
// BOSS Tone Studio (blocks 5C 00 … 01 1A 00, protocol-notes 2.8 "Assigns"); our own table.
//
// How the assign blocks work:
// - A target block has one field per effect: booster, delay, reverb, then the 31 mod/FX types (34 fields, the
//   order of FIELDS below). Booster, delay and reverb use their field; mod and FX use the field of their active
//   type; the function Delay 2 uses the delay field.
// - The target picks a parameter of that effect; 0 is "Preset" (0–100), the others are the effect's own knobs,
//   with their range and display.
// - Min/max store the raw value of the target in a field of their own, one per effect: u4x4 where a target is a
//   time (delay, reverb, pitch shifter, harmonist, DC-30), otherwise u7 0–127. The amp keeps 127 ("up to the
//   end") and does not check the target range [C 2026-11-17]; the app clamps and, when the target changes, sets
//   min/max to the full range of the new target as BOSS Tone Studio does.
// - The GA-FC blocks exist twice in the patch, (1) and (2). BOSS Tone Studio for Gen 3 uses only (1); (2) stays
//   out of the list for now (open, protocol-notes 2.8) and is kept raw in backups and .tsl files.

import { addr, type Address } from '../protocol/address';
import { BOOSTER_PARAMS, DELAY_PARAMS, MOD_FX_TYPES, REVERB_PARAMS } from './effects';
import { MOD_FX_PARAMS } from './modfx';
import { MASTER_KEY } from './sections';
import { encodingSize, rangeOf, type Encoding, type ParamDef, type RangeSpec } from './schema';

function blk(b1: number, b2: number): Address {
  return addr(0, b1, b2, 0);
}

/** Function of the expression pedal and of each GA-FC expression input, by raw value. */
export const EXP_FUNCTIONS = [
  'VOLUME',
  'FOOT VOLUME',
  'PEDAL FX',
  'PEDAL FX/FV',
  'BOOSTER',
  'MOD',
  'FX',
  'DELAY',
  'DELAY2',
  'REVERB',
] as const;

/** Raw values of EXP_FUNCTIONS that use a target field. */
export const EXP_FUNCTION = { booster: 4, mod: 5, fx: 6, delay: 7, delay2: 8, reverb: 9 } as const;

/** Footswitch on the amp (tip and ring of the FS jack). */
export const FS_FUNCTIONS = ['CH 1/2', 'BANK A/B', 'SOLO ON/OFF'] as const;

/** GA-FC footswitches, by raw value (BOSS Tone Studio lists raw 9 after raw 3). */
export const GAFC_FS_FUNCTIONS = [
  'BANK A/B',
  'PEDAL FX ON/OFF',
  'SEND/RETURN ON/OFF',
  'EQ ON/OFF',
  'DELAY TAP',
  'DELAY2 TAP',
  'BOOSTER SOLO ON/OFF',
  'SOLO ON/OFF',
  'GLOBAL EQ ON/OFF',
  'EQ2 ON/OFF',
] as const;

// ---- Fields: one per effect, in block order ----

/** "Preset": the amp's own curve for the effect, 0–100. */
const PRESET: RangeSpec = { min: 0, max: 100 };

export interface AssignTarget {
  readonly label: string;
  readonly range: RangeSpec;
  /** The parameter this target controls; undefined for Preset. */
  readonly param?: ParamDef;
}

export interface AssignField {
  /** `booster`, `delay`, `reverb`, or the key prefix of a mod/FX type (`chorus`, `pitchShifter` …). */
  readonly key: string;
  readonly label: string;
  /** Mod/FX type (raw, index into MOD_FX_TYPES) for the 31 type fields. */
  readonly modType?: number;
  /** Byte in a target block (= index in FIELDS). */
  readonly index: number;
  /** Byte and encoding in a min or max block. */
  readonly limitAt: number;
  readonly limitEncoding: Encoding;
  /** Raw range of the min/max field itself. */
  readonly limitMax: number;
  readonly targets: readonly AssignTarget[];
}

function targets(list: readonly ParamDef[], keys: readonly string[]): AssignTarget[] {
  return [
    { label: 'Preset', range: PRESET },
    ...keys.map((k) => {
      const param = k === MASTER_KEY.key ? MASTER_KEY : list.find((d) => d.key === k);
      if (!param) throw new Error(`Assign target ${k} is not in the list`);
      // With the group where the effect page shows one (Low Rate, Voice 1 Pitch), so targets stay unique.
      const label = param.group ? `${param.group} ${param.label}` : param.label;
      return { label, range: rangeOf(param), param };
    }),
  ];
}

/** Mod/FX fields in block order: type name (as in MOD_FX_TYPES), key prefix, targets after Preset. */
const MOD_FX_FIELDS: readonly (readonly [string, string, readonly string[]])[] = [
  [
    'CHORUS',
    'chorus',
    [
      'lowRate',
      'lowDepth',
      'lowPreDelay',
      'lowLevel',
      'highRate',
      'highDepth',
      'highPreDelay',
      'highLevel',
      'crossover',
      'directMix',
    ],
  ],
  ['FLANGER', 'flanger', ['rate', 'depth', 'resonance', 'manual', 'lowCut', 'effectLevel', 'directMix']],
  ['PHASER', 'phaser', ['rate', 'depth', 'resonance', 'manual', 'stepRate', 'effectLevel', 'directMix']],
  ['UNI-V', 'uniV', ['rate', 'depth', 'level']],
  ['TREMOLO', 'tremolo', ['waveShape', 'rate', 'depth', 'level']],
  ['VIBRATO', 'vibrato', ['rate', 'depth', 'level']],
  ['ROTARY', 'rotary', ['rate', 'depth', 'level']],
  ['RING MOD', 'ringMod', ['frequency', 'effectLevel', 'directMix']],
  ['SLOW GEAR', 'slowGear', ['sens', 'riseTime', 'level']],
  ['SLICER', 'slicer', ['rate', 'triggerSens', 'effectLevel', 'directMix']],
  ['COMP', 'comp', ['sustain', 'attack', 'tone', 'level']],
  ['LIMITER', 'limiter', ['threshold', 'ratio', 'attack', 'release', 'level']],
  ['T.WAH', 'twah', ['sens', 'freq', 'peak', 'effectLevel', 'directMix']],
  ['AUTO WAH', 'autoWah', ['rate', 'depth', 'freq', 'peak', 'effectLevel', 'directMix']],
  ['PEDAL WAH', 'pedalWah', ['pedalPos', 'pedalMin', 'pedalMax', 'effectLevel', 'directMix']],
  [
    'GRAPHIC EQ',
    'graphicEq',
    ['31hz', '62hz', '125hz', '250hz', '500hz', '1khz', '2khz', '4khz', '8khz', '16khz', 'level'],
  ],
  [
    'PARAMETRIC EQ',
    'parametricEq',
    [
      'lowGain',
      'lowMidGain',
      'highMidGain',
      'highGain',
      'level',
      'lowMidFreq',
      'lowMidQ',
      'highMidFreq',
      'highMidQ',
      'lowCut',
      'highCut',
    ],
  ],
  ['GUITAR SIM', 'guitarSim', ['body', 'low', 'high', 'level']],
  ['AC.GUITAR SIM', 'acGuitarSim', ['body', 'low', 'high', 'level']],
  ['AC.PROCESSOR', 'acProcessor', ['bass', 'middle', 'middleFreq', 'treble', 'presence', 'level']],
  [
    'WAVE SYNTH',
    'waveSynth',
    ['cutoff', 'resonance', 'synthLevel', 'filterSens', 'filterDecay', 'filterDepth', 'directMix'],
  ],
  ['OCTAVE', 'octave', ['effectLevel', 'directMix']],
  [
    'PITCH SHIFTER',
    'pitchShifter',
    [
      'voice1Pitch',
      'voice1Fine',
      'voice1PreDelay',
      'voice1Level',
      'voice1Feedback',
      'voice2Pitch',
      'voice2Fine',
      'voice2PreDelay',
      'voice2Level',
      'directMix',
    ],
  ],
  [
    'HARMONIST',
    'harmonist',
    [
      'voice1Harmony',
      'voice1Level',
      'voice1PreDelay',
      'voice1Feedback',
      'voice2Harmony',
      'voice2Level',
      'voice2PreDelay',
      'masterKey',
      'directMix',
    ],
  ],
  ['HUMANIZER', 'humanizer', ['rate', 'depth', 'sens', 'manual', 'level']],
  ['PHASER 90E', 'phaser90e', ['speed']],
  ['FLANGER 117E', 'flanger117e', ['manual', 'width', 'speed', 'regen']],
  ['WAH 95E', 'wah95e', ['pedalPos', 'pedalMin', 'pedalMax', 'effectLevel', 'directMix']],
  [
    'DC-30',
    'dc30',
    ['chorusIntensity', 'echoRepeatRate', 'echoIntensity', 'echoVolume', 'inputVolume', 'tone'],
  ],
  ['HEAVY OCTAVE', 'heavyOctave', ['1OctLevel', '2OctLevel', 'directMix']],
  ['PEDAL BEND', 'pedalBend', ['pedalPos', 'pitch', 'effectLevel', 'directMix']],
];

/** Every field, in block order; min/max lay out one after the other (u4x4 where a target is u4x4). */
export const FIELDS: readonly AssignField[] = (() => {
  const raw: { key: string; label: string; modType?: number; targets: AssignTarget[] }[] = [
    {
      key: 'booster',
      label: 'Booster',
      targets: targets(BOOSTER_PARAMS, [
        'drive',
        'tone',
        'bottom',
        'effectLevel',
        'solo',
        'soloLevel',
        'directMix',
      ]),
    },
    {
      key: 'delay',
      label: 'Delay',
      targets: targets(DELAY_PARAMS, [
        'time',
        'feedback',
        'highCut',
        'effectLevel',
        'directMix',
        'modRate',
        'modDepth',
      ]),
    },
    {
      key: 'reverb',
      label: 'Reverb',
      targets: targets(REVERB_PARAMS, [
        'time',
        'preDelay',
        'lowCut',
        'highCut',
        'density',
        'effectLevel',
        'directMix',
      ]),
    },
    ...MOD_FX_FIELDS.map(([type, prefix, keys]) => {
      const modType = (MOD_FX_TYPES as readonly string[]).indexOf(type);
      if (modType < 0) throw new Error(`Unknown mod/FX type ${type}`);
      return {
        key: prefix,
        label: type,
        modType,
        targets: targets(
          MOD_FX_PARAMS,
          keys.map((k) => (k === 'masterKey' ? MASTER_KEY.key : `${prefix}.${k}`)),
        ),
      };
    }),
  ];
  let at = 0;
  return raw.map((f, index) => {
    const times = f.targets.filter((t) => t.param?.encoding === 'u4x4');
    const limitEncoding: Encoding = times.length > 0 ? 'u4x4' : 'u7';
    const limitMax = times.length > 0 ? Math.max(...times.map((t) => t.range.max)) : 127;
    const field = { ...f, index, limitAt: at, limitEncoding, limitMax };
    at += encodingSize(limitEncoding);
    return field;
  });
})();

/** Bytes of a min or max block. */
export const LIMIT_BLOCK_LENGTH = FIELDS.reduce((n, f) => n + encodingSize(f.limitEncoding), 0);

export function fieldByKey(key: string): AssignField {
  const f = FIELDS.find((x) => x.key === key);
  if (!f) throw new Error(`No assign field ${key}`);
  return f;
}

/** The field of a mod/FX type (raw). */
export function modFxField(type: number): AssignField | undefined {
  return FIELDS.find((f) => f.modType === type);
}

/**
 * The field an expression input uses: by its function, and for mod and FX by the active type of that effect.
 * Undefined for Volume, Foot Volume and the pedal FX functions.
 */
export function expField(fn: number, modType?: number, fxType?: number): AssignField | undefined {
  switch (fn) {
    case EXP_FUNCTION.booster:
      return fieldByKey('booster');
    case EXP_FUNCTION.delay:
    case EXP_FUNCTION.delay2:
      return fieldByKey('delay');
    case EXP_FUNCTION.reverb:
      return fieldByKey('reverb');
    case EXP_FUNCTION.mod:
      return modType === undefined ? undefined : modFxField(modType);
    case EXP_FUNCTION.fx:
      return fxType === undefined ? undefined : modFxField(fxType);
    default:
      return undefined;
  }
}

// ---- Inputs ----

/** An expression input: function, target block, min block, max block. */
export interface ExpInput {
  readonly key: 'exp' | 'gafc.exp1' | 'gafc.exp2' | 'gafc.exp3';
  readonly label: string;
  readonly functionAt: Address;
  readonly targetBlock: Address;
  readonly minBlock: Address;
  readonly maxBlock: Address;
}

export const ASSIGN_BLOCK = {
  knobs: blk(0x00, 0x5c),
  fs: blk(0x00, 0x66),
  gafcFs: blk(0x00, 0x68),
} as const;

const expInput = (key: ExpInput['key'], label: string, b: readonly [number, number][]): ExpInput => {
  const [f, t, mn, mx] = b.map(([b1, b2]) => blk(b1, b2)) as [Address, Address, Address, Address];
  return { key, label, functionAt: f, targetBlock: t, minBlock: mn, maxBlock: mx };
};

export const EXP_INPUTS: readonly ExpInput[] = [
  expInput('exp', 'EXP Pedal', [
    [0x00, 0x5e],
    [0x00, 0x60],
    [0x00, 0x62],
    [0x00, 0x64],
  ]),
  expInput('gafc.exp1', 'GA-FC EXP 1', [
    [0x00, 0x6c],
    [0x00, 0x70],
    [0x00, 0x74],
    [0x00, 0x78],
  ]),
  expInput('gafc.exp2', 'GA-FC EXP 2', [
    [0x00, 0x7c],
    [0x01, 0x00],
    [0x01, 0x04],
    [0x01, 0x08],
  ]),
  expInput('gafc.exp3', 'GA-FC EXP 3', [
    [0x01, 0x0c],
    [0x01, 0x10],
    [0x01, 0x14],
    [0x01, 0x18],
  ]),
];

// ---- Parameters ----

// Every address was checked on the amp 2026-11-17 (-ParamTest -NoAsk: written, read back, no other byte
// changed, restored; protocol-notes 2.8, "Assigns"). Meaning rests on the layout, not on listening.

function select(key: string, label: string, at: Address, names: readonly string[], group?: string): ParamDef {
  return {
    key,
    label,
    at,
    encoding: 'u7',
    min: 0,
    max: names.length - 1,
    control: 'leds',
    display: { table: names },
    ...(group ? { group } : {}),
    status: 'C',
  };
}

const targetParam = (prefix: string, f: AssignField, block: Address): ParamDef =>
  select(
    `${prefix}.${f.key}.target`,
    'Target',
    block + f.index,
    f.targets.map((t) => t.label),
    f.label,
  );

function limitParam(prefix: string, f: AssignField, which: 'min' | 'max', block: Address): ParamDef {
  const key = `${prefix}.${f.key}.${which}`;
  return {
    key,
    label: which === 'min' ? 'Min' : 'Max',
    at: block + f.limitAt,
    encoding: f.limitEncoding,
    min: 0,
    max: f.limitMax,
    control: 'knob',
    group: f.label,
    rangeBy: { key: `${prefix}.${f.key}.target`, ranges: f.targets.map((t) => t.range) },
    status: 'C',
  };
}

/** Effect knobs on the amp: one target per field. */
export const KNOB_ASSIGN_PARAMS: readonly ParamDef[] = FIELDS.map((f) =>
  targetParam('assign.knobs', f, ASSIGN_BLOCK.knobs),
);

/** Function, then target, min and max of every field, for one expression input. */
export function expInputParams(input: ExpInput): ParamDef[] {
  const prefix = `assign.${input.key}`;
  return [
    select(`${prefix}.function`, 'Function', input.functionAt, EXP_FUNCTIONS),
    ...FIELDS.flatMap((f) => [
      targetParam(prefix, f, input.targetBlock),
      limitParam(prefix, f, 'min', input.minBlock),
      limitParam(prefix, f, 'max', input.maxBlock),
    ]),
  ];
}

export const FS_PARAMS: readonly ParamDef[] = [
  select('assign.fs.tip', 'Tip', ASSIGN_BLOCK.fs + 0, FS_FUNCTIONS),
  select('assign.fs.ring', 'Ring', ASSIGN_BLOCK.fs + 1, FS_FUNCTIONS),
];

export const GAFC_FS_PARAMS: readonly ParamDef[] = [1, 2, 3].map((n) =>
  select(`assign.gafc.fs${n}`, `FS${n}`, ASSIGN_BLOCK.gafcFs + n - 1, GAFC_FS_FUNCTIONS),
);

/** Every assign parameter of the list. */
export const ASSIGN_PARAMS: readonly ParamDef[] = [
  ...KNOB_ASSIGN_PARAMS,
  ...EXP_INPUTS.flatMap(expInputParams),
  ...FS_PARAMS,
  ...GAFC_FS_PARAMS,
];

/**
 * Min/max parameters whose range follows a target, by the key of that target. Changing a target sets them to
 * the full range of the new target (BOSS Tone Studio does the same; the amp does not, protocol-notes 2.8).
 */
export const RANGE_DEPENDENTS: ReadonlyMap<string, readonly ParamDef[]> = (() => {
  const m = new Map<string, ParamDef[]>();
  for (const p of ASSIGN_PARAMS) {
    if (!p.rangeBy) continue;
    const list = m.get(p.rangeBy.key) ?? [];
    list.push(p);
    m.set(p.rangeBy.key, list);
  }
  return m;
})();
