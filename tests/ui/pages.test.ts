import { describe, expect, it } from 'vitest';
import { DELAY2, EFFECTS } from '../../src/model/params';
import { MASTER_KEY } from '../../src/model/sections';
import { KNOBS_PER_PAGE, PAGE_UNITS, effectLayout } from '../../src/ui/pages';

const group = (key: string) => {
  const g = EFFECTS.find((e) => e.key === key);
  if (!g) throw new Error(key);
  return g;
};
const mod = group('mod');
const TYPE = (name: string) => mod.typeNames.indexOf(name);
const values =
  (v: Record<string, number>) =>
  (key: string): number | undefined =>
    v[key];
const title = (p: { group: string | undefined; part?: { index: number; count: number } }) =>
  `${p.group ?? 'main'}${p.part ? ` ${p.part.index}/${p.part.count}` : ''}`;

describe('effect pages (Phase 2, direction A)', () => {
  it('a small type is one page; its type choice sits above', () => {
    const l = effectLayout(mod.params, TYPE('COMP'), values({}));
    expect(l.head.map((p) => p.key)).toEqual(['comp.type']);
    expect(l.pages.map(title)).toEqual(['main']);
    expect(l.pages[0]?.knobs.map((p) => p.label)).toEqual(['Sustain', 'Attack', 'Tone', 'Level']);
  });

  it('never more than six knobs and never more than the height budget on a page; graphic EQ makes two pages', () => {
    for (let t = 0; t < mod.typeNames.length; t++) {
      const l = effectLayout(mod.params, t, values({ 'harmonist.voice': 1, 'pitchShifter.voice': 1 }));
      for (const p of l.pages) {
        expect(p.knobs.length, mod.typeNames[t]).toBeLessThanOrEqual(KNOBS_PER_PAGE);
        expect(Math.ceil(p.knobs.length / 3) + p.choices.length / 2, mod.typeNames[t]).toBeLessThanOrEqual(
          PAGE_UNITS,
        );
      }
    }
    expect(effectLayout(mod.params, TYPE('GRAPHIC EQ'), values({})).pages.map(title)).toEqual([
      'main 1/2',
      'main 2/2',
    ]);
  });

  it('harmonist: voices first, voice 2 only with two voices, user scale only for USER, master key in the mix', () => {
    const h = TYPE('HARMONIST');
    const one = effectLayout(mod.params, h, values({ 'harmonist.voice': 0 }), [MASTER_KEY]);
    expect(one.head.map((p) => p.key)).toEqual(['harmonist.voice']);
    expect(one.pages.map(title)).toEqual(['Voice 1', 'main']);
    expect(one.pages[1]?.knobs.map((p) => p.key)).toEqual(['harmonist.directMix', 'harmonist.masterKey']);
    const user = effectLayout(
      mod.params,
      h,
      values({ 'harmonist.voice': 1, 'harmonist.voice1Harmony': 29, 'harmonist.voice2Harmony': 3 }),
    );
    expect(user.pages.map(title)).toEqual([
      'Voice 1',
      'Voice 2',
      'User Voice 1 1/2',
      'User Voice 1 2/2',
      'main',
    ]);
  });

  it('chorus: low and high as their own pages, then crossover and mix; SDE-3000 puts its five switches on a page of their own', () => {
    expect(effectLayout(mod.params, TYPE('CHORUS'), values({})).pages.map(title)).toEqual([
      'Low',
      'High',
      'main',
    ]);
    const delay = effectLayout(group('delay').params, 7, values({}));
    expect(delay.head).toEqual([]);
    expect(delay.pages.map(title)).toEqual(['main 1/2', 'main 2/2']);
    expect(delay.pages[0]?.knobs).toHaveLength(6);
    expect(delay.pages[1]?.choices.map((p) => p.key)).toContain('modSwitch');
  });

  it('reverb: layer mode is a head choice; Delay 2 uses the delay layout', () => {
    expect(effectLayout(group('reverb').params, 0, values({})).head.map((p) => p.key)).toEqual(['layerMode']);
    expect(effectLayout(DELAY2.params, 0, values({})).pages[0]?.knobs.length).toBe(5);
  });
});
