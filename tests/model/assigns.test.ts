import { describe, expect, it } from 'vitest';
import {
  ASSIGN_PARAMS,
  EXP_FUNCTION,
  EXP_INPUTS,
  FIELDS,
  KNOB_ASSIGN_PARAMS,
  LIMIT_BLOCK_LENGTH,
  RANGE_DEPENDENTS,
  expField,
  fieldByKey,
  modFxField,
} from '../../src/model/assigns';
import { MOD_FX_TYPES } from '../../src/model/effects';
import { PATCH_PARAMS } from '../../src/model/params';
import { PatchImage, patchBlockAt, readRaw } from '../../src/model/patch';
import { effectiveRange, encodingSize, type ParamDef } from '../../src/model/schema';

const byKey = (key: string): ParamDef => {
  const p = ASSIGN_PARAMS.find((d) => d.key === key);
  if (!p) throw new Error(`missing ${key}`);
  return p;
};

/** The assign blocks of the expression pedal as every stored slot in the captures holds them (factory state). */
function factory(): PatchImage {
  const max = [0x7f, 0, 7, 0x0d, 0, 0, 1, 0x0f, 4, ...Array<number>(40).fill(0x7f)];
  const exp = EXP_INPUTS[0];
  if (!exp) throw new Error('no exp input');
  return PatchImage.of(
    new Map<number, readonly number[]>([
      [exp.functionAt, [3]],
      [exp.targetBlock, Array<number>(34).fill(0)],
      [exp.minBlock, Array<number>(49).fill(0)],
      [exp.maxBlock, max],
    ]),
  );
}

describe('assign fields', () => {
  it('has 34 fields: booster, delay, reverb and every mod/FX type once', () => {
    expect(FIELDS).toHaveLength(34);
    expect(FIELDS.slice(0, 3).map((f) => f.key)).toEqual(['booster', 'delay', 'reverb']);
    const types = FIELDS.slice(3).map((f) => f.modType);
    expect(new Set(types).size).toBe(MOD_FX_TYPES.length);
    for (let t = 0; t < MOD_FX_TYPES.length; t++) expect(modFxField(t)?.label).toBe(MOD_FX_TYPES[t]);
  });

  it('lays out min/max in 49 bytes with u4x4 for the time fields', () => {
    expect(LIMIT_BLOCK_LENGTH).toBe(49);
    const u4 = FIELDS.filter((f) => f.limitEncoding === 'u4x4').map((f) => [f.key, f.limitAt, f.limitMax]);
    expect(u4).toEqual([
      ['delay', 1, 2000],
      ['reverb', 5, 500],
      ['pitchShifter', 31, 300],
      ['harmonist', 35, 300],
      ['dc30', 43, 600],
    ]);
    expect(fieldByKey('heavyOctave').limitAt).toBe(47);
    expect(fieldByKey('pedalBend').limitAt).toBe(48);
  });

  it('every target param of a mod/FX field belongs to its type', () => {
    for (const f of FIELDS.slice(3)) {
      for (const t of f.targets.slice(1)) {
        if (t.param?.key === 'harmonist.masterKey') continue;
        expect(t.param?.visibleFor, `${f.key} ${t.label}`).toContain(f.modType);
      }
    }
  });

  it('target names are unique within a field (with the group: Low Rate, Voice 1 Pitch)', () => {
    for (const f of FIELDS) {
      const names = f.targets.map((t) => t.label);
      expect(new Set(names).size, `${f.key}: ${names.join(', ')}`).toBe(names.length);
    }
    expect(fieldByKey('chorus').targets[1]?.label).toBe('Low Rate');
  });

  it('picks the field by function and active type', () => {
    expect(expField(EXP_FUNCTION.delay2)?.key).toBe('delay');
    expect(expField(EXP_FUNCTION.mod, MOD_FX_TYPES.indexOf('CHORUS'))?.key).toBe('chorus');
    expect(expField(EXP_FUNCTION.fx, undefined, MOD_FX_TYPES.indexOf('DC-30'))?.key).toBe('dc30');
    expect(expField(0)).toBeUndefined();
    expect(expField(3)).toBeUndefined();
  });
});

describe('assign parameters', () => {
  it('every parameter lies inside its block and the keys are unique', () => {
    expect(new Set(ASSIGN_PARAMS.map((p) => p.key)).size).toBe(ASSIGN_PARAMS.length);
    for (const def of ASSIGN_PARAMS) {
      const block = patchBlockAt(def.at);
      expect(block, def.key).toBeDefined();
      const end = def.at + encodingSize(def.encoding);
      expect(end, def.key).toBeLessThanOrEqual((block?.offset ?? 0) + (block?.length ?? 0));
    }
  });

  it('no two parameters of the patch list share a byte', () => {
    const seen = new Map<number, string>();
    for (const def of PATCH_PARAMS) {
      for (let i = 0; i < encodingSize(def.encoding); i++) {
        const other = seen.get(def.at + i);
        expect(other, `${def.key} overlaps ${other}`).toBeUndefined();
        seen.set(def.at + i, def.key);
      }
    }
  });

  it('counts: 34 knob targets, 4 × (1 + 34 × 3) expression parameters, 2 + 3 footswitches', () => {
    expect(KNOB_ASSIGN_PARAMS).toHaveLength(34);
    expect(ASSIGN_PARAMS).toHaveLength(34 + 4 * 103 + 5);
  });

  it('every assign address is confirmed on the amp (2026-11-17)', () => {
    expect(ASSIGN_PARAMS.every((p) => p.status === 'C')).toBe(true);
  });

  it('reads the factory state: Pedal FX/FV, targets Preset, min 0, max 127 or the longest time', () => {
    const image = factory();
    expect(readRaw(image, byKey('assign.exp.function'))).toBe(3);
    expect(readRaw(image, byKey('assign.exp.delay.target'))).toBe(0);
    expect(readRaw(image, byKey('assign.exp.booster.max'))).toBe(127);
    expect(readRaw(image, byKey('assign.exp.delay.max'))).toBe(2000);
    expect(readRaw(image, byKey('assign.exp.reverb.max'))).toBe(500);
    expect(readRaw(image, byKey('assign.exp.chorus.max'))).toBe(127);
  });

  it('min/max take range and display from the target', () => {
    const max = byKey('assign.exp.delay.max');
    const at = (target: number) => (k: string) => (k === 'assign.exp.delay.target' ? target : undefined);
    expect(effectiveRange(max, at(0))).toEqual({ min: 0, max: 100 }); // Preset
    expect(effectiveRange(max, at(1))).toEqual({ min: 1, max: 2000, display: { unit: 'ms' } }); // Time
    expect(effectiveRange(max, at(2))).toEqual({ min: 0, max: 100 }); // Feedback
    expect(effectiveRange(max, at(3)).display?.table?.length).toBe(15); // High Cut
    expect(effectiveRange(max, at(4)).max).toBe(120); // Effect Level
    expect(effectiveRange(max, () => undefined)).toEqual({ min: 0, max: 2000 });
    expect(effectiveRange(max, () => 99)).toEqual({ min: 0, max: 2000 });
  });

  it('every target range fits into the raw range of its min/max field', () => {
    for (const p of ASSIGN_PARAMS) {
      for (const r of p.rangeBy?.ranges ?? []) {
        expect(r?.min, p.key).toBeGreaterThanOrEqual(p.min);
        expect(r?.max, p.key).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it('lists min and max as dependents of each expression target, not the knob targets', () => {
    expect(RANGE_DEPENDENTS.get('assign.gafc.exp2.chorus.target')?.map((p) => p.key)).toEqual([
      'assign.gafc.exp2.chorus.min',
      'assign.gafc.exp2.chorus.max',
    ]);
    expect(RANGE_DEPENDENTS.has('assign.knobs.chorus.target')).toBe(false);
    expect(RANGE_DEPENDENTS.size).toBe(4 * 34);
  });
});
