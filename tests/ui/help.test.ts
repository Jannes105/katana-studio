import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AMP_KNOBS,
  AMP_POWERAMP_VARIATION,
  AMP_RESONANCE,
  AMP_TYPE,
  AMP_TYPE_NAMES,
  AMP_VARIATION,
  CONTOUR_SELECT,
  DELAY2,
  EFFECTS,
  NS_RELEASE,
  NS_SWITCH,
  NS_THRESHOLD,
  PATCH_PARAMS,
  contourFreqShift,
} from '../../src/model/params';
import { EXP_INPUTS } from '../../src/model/assigns';
import { SYSTEM_PARAMS } from '../../src/model/system';
import { SYSTEM_SECTIONS } from '../../src/ui/system-pages';
import { CABINET_RESONANCE, contourType, sectionByKey } from '../../src/model/sections';
import { instanceParam, type ParamDef } from '../../src/model/schema';
import { relativeDrag, LONG_PRESS_MS } from '../../src/ui/drag';
import { HELP_LIMITS, HELP_TABLES, helpFor, helpKeys, typeKey } from '../../src/ui/help/help';
import { longPress } from '../../src/ui/help/press';
import { LANGUAGES } from '../../src/ui/i18n';

describe('explanation texts (Phase 3a)', () => {
  it('both languages have the same keys', () => {
    expect(Object.keys(HELP_TABLES.de).sort()).toEqual(Object.keys(HELP_TABLES.en).sort());
  });

  it('every field stays within its limit, so the window never scrolls', () => {
    for (const lang of LANGUAGES) {
      for (const [key, text] of Object.entries(HELP_TABLES[lang])) {
        for (const [field, value] of Object.entries(text) as [keyof typeof HELP_LIMITS, string][]) {
          expect(value.length, `${lang} ${key}.${field}`).toBeLessThanOrEqual(HELP_LIMITS[field]);
          expect(value.trim(), `${lang} ${key}.${field}`).not.toBe('');
        }
      }
    }
  });

  it('keys drop the variation and fall back to shorter forms', () => {
    expect(helpKeys('delay.1.time')).toEqual(['delay.time', 'time']);
    expect(helpKeys('delay2.0.time')).toEqual(['delay2.time', 'delay.time', 'time']);
    expect(helpKeys('mod.2.twah.effectLevel')).toEqual([
      'mod.twah.effectLevel',
      'twah.effectLevel',
      'effectLevel',
    ]);
    expect(helpKeys('eq1.geq.band3')).toEqual([
      'eq1.geq.band3',
      'eq.geq.band',
      'geq.band3',
      'geq.band',
      'band3',
      'band',
    ]);
    expect(helpKeys('type.modfx.T.WAH')).toEqual(['type.modfx.T.WAH']);
  });

  it('a specific text wins over the shared one', () => {
    expect(helpFor('en', 'booster.0.effectLevel')).toBe(HELP_TABLES.en['booster.effectLevel']);
    expect(helpFor('en', 'reverb.2.directMix')).toBe(HELP_TABLES.en['directMix']);
    expect(helpFor('de', 'delay2.1.feedback')).toBe(HELP_TABLES.de['delay.feedback']);
    expect(helpFor('en', 'no.such.thing')).toBeUndefined();
  });

  // Scope of PR 1: amp, noise suppressor, contour, booster, delay, Delay 2, reverb, EQ and all types.
  const basics: ParamDef[] = [
    ...AMP_KNOBS,
    AMP_TYPE,
    AMP_VARIATION,
    AMP_RESONANCE,
    AMP_POWERAMP_VARIATION,
    CABINET_RESONANCE,
    NS_SWITCH,
    NS_THRESHOLD,
    NS_RELEASE,
    CONTOUR_SELECT,
    ...([1, 2, 3] as const).flatMap((c) => [contourType(c), contourFreqShift(c)]),
    ...[...EFFECTS, DELAY2]
      .filter((g) => g.key !== 'mod' && g.key !== 'fx')
      .flatMap((g) => [g.switch, g.colour, ...g.params.map((p) => instanceParam(g, 0, p))]),
    ...(['eq1', 'eq2'] as const).flatMap((k) => [sectionByKey(k).switch, ...sectionByKey(k).params]),
  ];

  it('every basic parameter has a text in both languages', () => {
    for (const lang of LANGUAGES)
      for (const p of basics) expect(helpFor(lang, p.key), `${lang} ${p.key}`).toBeDefined();
  });

  it('every type has a text: amp, booster, Mod/FX, delay, reverb', () => {
    const groups = [...EFFECTS, DELAY2];
    const names = (key: string) => groups.find((g) => g.key === key)?.typeNames ?? [];
    const all = [
      ...AMP_TYPE_NAMES.map((n) => typeKey('amp', n)),
      ...names('booster').map((n) => typeKey('booster', n)),
      ...names('mod').map((n) => typeKey('modfx', n)),
      ...names('fx').map((n) => typeKey('modfx', n)),
      ...names('delay').map((n) => typeKey('delay', n)),
      ...names('reverb').map((n) => typeKey('reverb', n)),
    ];
    expect(all.length).toBeGreaterThan(70);
    for (const lang of LANGUAGES) for (const k of all) expect(helpFor(lang, k), `${lang} ${k}`).toBeDefined();
  });
});

// A stand-in for an element: enough of the DOM for the two actions.
function fakeNode() {
  const node = new EventTarget() as EventTarget & {
    style: Record<string, string>;
    setPointerCapture: () => void;
  };
  node.style = {};
  node.setPointerCapture = () => {};
  return node as unknown as HTMLElement;
}
function pointer(type: string, y: number, x = 0): Event {
  return Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, clientX: x, clientY: y });
}

describe('long press (Phase 3a)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function knob() {
    const node = fakeNode();
    const calls = { set: [] as number[], long: 0, tap: 0, double: 0 };
    relativeDrag(node, {
      axis: 'y',
      pxPerStep: 2,
      get: () => 50,
      set: (v) => calls.set.push(v),
      enabled: () => true,
      onTap: () => calls.tap++,
      onDoubleTap: () => calls.double++,
      onLongPress: () => calls.long++,
    });
    return { node, calls };
  }

  it('on a knob: explains after holding still and changes nothing afterwards', () => {
    const { node, calls } = knob();
    node.dispatchEvent(pointer('pointerdown', 100));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(calls.long).toBe(1);
    node.dispatchEvent(pointer('pointermove', 20));
    node.dispatchEvent(pointer('pointerup', 20));
    expect(calls.set).toEqual([]);
    expect(calls.tap).toBe(0);
  });

  it('on a knob: dragging first means no explanation', () => {
    const { node, calls } = knob();
    node.dispatchEvent(pointer('pointerdown', 100));
    node.dispatchEvent(pointer('pointermove', 90));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    node.dispatchEvent(pointer('pointerup', 90));
    expect(calls.long).toBe(0);
    expect(calls.set).toEqual([55]);
  });

  it('on a knob: a sideways wobble cancels the long press too', () => {
    const { node, calls } = knob();
    node.dispatchEvent(pointer('pointerdown', 100, 0));
    node.dispatchEvent(pointer('pointermove', 100, 10));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(calls.long).toBe(0);
  });

  it('on a knob: double tap still resets, and a long press after a tap is not a double tap', () => {
    const { node, calls } = knob();
    vi.advanceTimersByTime(1000); // the first tap must not count as the second of a double tap
    for (let i = 0; i < 2; i++) {
      node.dispatchEvent(pointer('pointerdown', 100));
      node.dispatchEvent(pointer('pointerup', 100));
    }
    expect(calls.double).toBe(1);
    vi.advanceTimersByTime(1000);
    node.dispatchEvent(pointer('pointerdown', 100));
    node.dispatchEvent(pointer('pointerup', 100));
    node.dispatchEvent(pointer('pointerdown', 100));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    node.dispatchEvent(pointer('pointerup', 100));
    expect(calls.long).toBe(1);
    expect(calls.double).toBe(1);
  });

  it('on a button: the click after a long press is swallowed, a short tap clicks', () => {
    const node = fakeNode();
    let long = 0;
    let clicks = 0;
    longPress(node, () => long++);
    node.addEventListener('click', () => clicks++);

    node.dispatchEvent(pointer('pointerdown', 0));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    node.dispatchEvent(pointer('pointerup', 0));
    node.dispatchEvent(new Event('click', { cancelable: true }));
    expect([long, clicks]).toEqual([1, 0]);

    node.dispatchEvent(pointer('pointerdown', 0));
    vi.advanceTimersByTime(100);
    node.dispatchEvent(pointer('pointerup', 0));
    node.dispatchEvent(new Event('click', { cancelable: true }));
    expect([long, clicks]).toEqual([1, 1]);
  });

  it('on a button: moving the finger (scrolling a list) cancels', () => {
    const node = fakeNode();
    let long = 0;
    longPress(node, () => long++);
    node.dispatchEvent(pointer('pointerdown', 0));
    node.dispatchEvent(pointer('pointermove', 12));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(long).toBe(0);
  });
});

describe('explanations for everything shown (Phase 3a, PR 2)', () => {
  const shown: ParamDef[] = [
    ...PATCH_PARAMS.filter((p) => p.control !== 'text'),
    ...[...EFFECTS, DELAY2].flatMap((g) => g.params.map((p) => instanceParam(g, 0, p))),
    ...SYSTEM_PARAMS,
  ].filter((p) => !p.readonly);

  it('every parameter the app shows has a text in both languages', () => {
    expect(shown.length).toBeGreaterThan(1000);
    for (const lang of LANGUAGES) {
      const missing = shown.filter((p) => !helpFor(lang, p.key)).map((p) => p.key);
      expect(missing, lang).toEqual([]);
    }
  });

  it('chain blocks, expression inputs and system sections have a text', () => {
    const blocks = ['pedalFx', 'booster', 'mod', 'fx', 'delay', 'eq1', 'eq2', 'amp', 'sendReturn'];
    const keys = [
      ...blocks.map((b) => `block.${b}`),
      'block.footVolume',
      'block.delay2',
      'block.reverb',
      ...EXP_INPUTS.map((i) => `ctl.input.${i.key}`),
      ...SYSTEM_SECTIONS.map((s) => `system.section.${s}`),
    ];
    for (const lang of LANGUAGES)
      for (const k of keys) expect(helpFor(lang, k), `${lang} ${k}`).toBeDefined();
  });

  it('bands, voices, inputs and notes share one text', () => {
    expect(helpKeys('mod.0.chorus.highRate')).toContain('chorus.rate');
    expect(helpKeys('fx.1.pitchShifter.voice2Pitch')).toContain('pitchShifter.voicePitch');
    expect(helpKeys('mod.0.harmonist.userVoice1Fs')).toContain('harmonist.userVoice');
    expect(helpKeys('mod.0.graphicEq.1khz')).toContain('geq.band');
    expect(helpKeys('fx.2.parametricEq.lowMidQ')).toContain('peq.lowMidQ');
    expect(helpKeys('assign.gafc.exp2.chorus.max')).toContain('assign.exp.max');
    expect(helpKeys('assign.knobs.delay.target')).toContain('assign.knobs.target');
    expect(helpKeys('system.midi.cc.gafcFs1')).toContain('midi.cc');
    expect(helpKeys('system.lineOut.m2.micType')).toContain('lineOut.m.micType');
    expect(helpFor('en', 'assign.exp.reverb.min')).toBe(HELP_TABLES.en['assign.exp.min']);
  });
});
