// Pages of the SYSTEM area in the control tab (Phase 3, direction A, decided 2026-11-17): five sections, each
// with choices that stay on top and knobs or choices cut into pages (six knobs or eight choices per page), so
// nothing scrolls. Plain functions, testable without Svelte.

import { visibleFor, type ParamDef } from '../model/schema';
import { SYSTEM_PARAMS } from '../model/system';

export type SystemSection = 'globalEq' | 'lineOut' | 'usb' | 'powerAmpIn' | 'midi';
export const SYSTEM_SECTIONS: readonly SystemSection[] = ['globalEq', 'lineOut', 'usb', 'powerAmpIn', 'midi'];
export const SECTION_LABEL: Readonly<Record<SystemSection, string>> = {
  globalEq: 'Global EQ',
  lineOut: 'Line Out',
  usb: 'USB',
  powerAmpIn: 'Power Amp In',
  midi: 'MIDI',
};

export interface SystemPage {
  readonly title: string;
  /** Choices shown as a grid of two columns. */
  readonly choices: readonly ParamDef[];
  readonly knobs: readonly ParamDef[];
}
export interface SystemLayout {
  /** Choices above the pages (position, type, memory …). */
  readonly head: readonly ParamDef[];
  readonly pages: readonly SystemPage[];
}

const KNOBS_PER_PAGE = 6;
const CHOICES_PER_PAGE = 8;

const BY_KEY = new Map(SYSTEM_PARAMS.map((p) => [p.key, p] as const));
export function systemParam(key: string): ParamDef {
  const p = BY_KEY.get(key);
  if (!p) throw new Error(`No SYSTEM parameter ${key}`);
  return p;
}
const isKnob = (p: ParamDef) => p.control === 'knob';

function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
function pagesOf(title: string, params: readonly ParamDef[]): SystemPage[] {
  const choices = chunk(
    params.filter((p) => !isKnob(p)),
    CHOICES_PER_PAGE,
  );
  const knobs = chunk(params.filter(isKnob), KNOBS_PER_PAGE);
  const parts = [
    ...choices.map((c) => ({ choices: c, knobs: [] as ParamDef[] })),
    ...knobs.map((k) => ({ choices: [] as ParamDef[], knobs: k })),
  ];
  return parts.map((p, i) => ({
    title: parts.length > 1 ? `${title} ${i + 1}/${parts.length}` : title,
    ...p,
  }));
}

/** The layout of a section; `valueOf` gives the raw value of a SYSTEM parameter by key. */
export function systemLayout(sec: SystemSection, valueOf: (key: string) => number | undefined): SystemLayout {
  const all = SYSTEM_PARAMS;
  switch (sec) {
    case 'globalEq': {
      // The selected memory (on/off and memory are a row of their own above, see the view).
      const m = (valueOf('system.globalEq.select') ?? 0) + 1;
      const type = valueOf(`system.globalEq.${m}.type`);
      const own = all.filter((p) => p.key.startsWith(`system.globalEq.${m}.`) && visibleFor(p, type));
      return {
        head: own.filter((p) => !isKnob(p)),
        pages: pagesOf(type === 1 ? 'GE-10' : 'EQ', own.filter(isKnob)),
      };
    }
    case 'lineOut': {
      const mem = (valueOf('system.lineOut.select') ?? 0) + 1;
      const own = all.filter((p) => p.key.startsWith(`system.lineOut.m${mem}.`));
      return {
        head: [
          systemParam('system.lineOut.airFeel'),
          systemParam('system.lineOut.custom'),
          systemParam('system.lineOut.select'),
          ...own.filter((p) => !isKnob(p)),
        ],
        pages: pagesOf(`M${mem}`, own.filter(isKnob)),
      };
    }
    case 'midi':
      return {
        head: [systemParam('system.midi.channel')],
        pages: [
          ...pagesOf(
            'CC',
            all.filter((p) => p.key.startsWith('system.midi.cc.')),
          ),
          ...pagesOf(
            'PC',
            all.filter((p) => p.key.startsWith('system.midi.pc.')),
          ),
        ],
      };
    default: {
      const own = all.filter((p) => p.key.startsWith(`system.${sec}.`));
      return { head: own.filter((p) => !isKnob(p)), pages: pagesOf(SECTION_LABEL[sec], own.filter(isKnob)) };
    }
  }
}
