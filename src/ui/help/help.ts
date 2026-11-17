// Explanations of parameters and types (PLAN 5, Phase 3a): own texts, one table per language (en.ts, de.ts).
// A long press on a control opens the explanation; nothing else in the UI changes.
//
// Keys follow the parameter keys without the variation (`delay.1.time` -> `delay.time`). A missing key falls
// back to shorter forms, so a recurring parameter is written once: `twah.effectLevel` -> `effectLevel`,
// `eq1.peq.lowCut` -> `eq.peq.lowCut` -> `peq.lowCut` -> `lowCut`. Types have keys of their own:
// `type.<effect>.<name>` (`type.amp.Clean`, `type.modfx.CHORUS`), looked up exactly.

import type { Language } from '../i18n';
import { HELP_DE } from './de';
import { HELP_EN, type HelpText } from './en';

export type { HelpText } from './en';

/** Length limits per field (characters), so the window fits a 375×667 screen without scrolling. */
export const HELP_LIMITS: Readonly<Record<keyof HelpText, number>> = {
  short: 70,
  what: 170,
  when: 130,
  start: 50,
  tip: 150,
};

export const HELP_TABLES: Readonly<Record<Language, Readonly<Record<string, HelpText>>>> = {
  en: HELP_EN,
  de: HELP_DE,
};

/** What a long press asks to explain: the lookup key, the title (label as on the amp) and where it belongs. */
export interface HelpTarget {
  readonly key: string;
  readonly title: string;
  /** E.g. `Delay · TAPE ECHO`; shown small above the title. */
  readonly context?: string;
}

/**
 * Keys to try for a parameter key, most specific first. Variation numbers are dropped (`delay.1.time`); each
 * shorter suffix is tried as is and with trailing digits removed from its segments (`delay2.time` ->
 * `delay.time`, `geq.band3` -> `geq.band`).
 */
export function helpKeys(key: string): string[] {
  if (key.startsWith('type.')) return [key];
  const parts = key.split('.').filter((p) => !/^\d+$/.test(p));
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const rest = parts.slice(i);
    for (const k of [rest.join('.'), rest.map((p) => p.replace(/\d+$/, '')).join('.')]) {
      if (k !== '' && !k.split('.').includes('') && !out.includes(k)) out.push(k);
    }
  }
  return out;
}

/** The explanation for a key in a language, or undefined if there is none (yet). */
export function helpFor(lang: Language, key: string): HelpText | undefined {
  const table = HELP_TABLES[lang];
  for (const k of helpKeys(key)) {
    const text = table[k];
    if (text) return text;
  }
  return undefined;
}

/** Key of a type explanation, e.g. typeKey('delay', 'TAPE ECHO'). */
export function typeKey(effect: string, name: string): string {
  return `type.${effect}.${name}`;
}

/** The help target of a parameter: its key and label, with an optional context such as `Amp`. */
export function paramHelp(
  def: { readonly key: string; readonly label: string },
  context?: string,
): HelpTarget {
  return context === undefined
    ? { key: def.key, title: def.label }
    : { key: def.key, title: def.label, context };
}
