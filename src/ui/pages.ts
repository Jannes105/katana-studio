// Pages of an effect page (Phase 2, direction A "pages", decided 2026-11-17): the parameters a type shows are cut
// into pages of at most six knobs, one group (Voice 1, Low, …) per page or pages, so long types such as the
// harmonist never become an endless list. Leading choices of the type (type, mode, voice) stay above the pages.

import { shownWith, visibleFor, type ParamDef } from '../model/schema';

/** Knobs per page at most: 3 × 2 (PAGE_UNITS also counts the rows of choices). */
export const KNOBS_PER_PAGE = 6;

export interface EffectPage {
  /** Group name, `undefined` for the parameters without a group ("main"). With a number when split, e.g. 2/2. */
  readonly group: string | undefined;
  readonly part?: { readonly index: number; readonly count: number };
  /** Choices and switches of this page (shown above its knobs). */
  readonly choices: readonly ParamDef[];
  readonly knobs: readonly ParamDef[];
}

export interface EffectLayout {
  /** Choices before the first knob of the list (type, mode, voice): shown above the pages. */
  readonly head: readonly ParamDef[];
  readonly pages: readonly EffectPage[];
}

const isKnob = (p: ParamDef) => p.control === 'knob';

/**
 * The layout for one type. `params` are the definitions of the effect (relative to its block), `extra` patch
 * parameters that belong to the main page (e.g. the master key of the harmonist), `valueOf` the raw value of a
 * sibling by key (for showIf). The main page comes first, except when there are groups and it holds only a mix
 * (pitch shifter, harmonist: the voices first).
 */
export function effectLayout(
  params: readonly ParamDef[],
  type: number | undefined,
  valueOf: (key: string) => number | undefined,
  extra: readonly ParamDef[] = [],
): EffectLayout {
  const shown = params.filter((p) => !p.readonly && visibleFor(p, type) && shownWith(p, valueOf));
  const firstKnob = shown.findIndex(isKnob);
  const head = shown.filter(
    (p, i) => !isKnob(p) && p.group === undefined && (firstKnob < 0 || i < firstKnob),
  );
  const rest = [...shown.filter((p) => !head.includes(p)), ...extra];

  const groups: (string | undefined)[] = [];
  for (const p of rest) if (!groups.includes(p.group)) groups.push(p.group);
  // Voices first when the ungrouped part comes after the groups in the list (pitch shifter, harmonist).
  const firstGrouped = rest.findIndex((p) => p.group !== undefined);
  const firstMain = rest.findIndex((p) => p.group === undefined);
  if (firstGrouped >= 0 && firstMain > firstGrouped) {
    groups.splice(groups.indexOf(undefined), 1);
    groups.push(undefined);
  }

  const pages: EffectPage[] = [];
  for (const g of groups) {
    // Fill pages in list order; a page holds at most PAGE_UNITS (knob row = 1, choice row = 0.5).
    const parts: { choices: ParamDef[]; knobs: ParamDef[] }[] = [];
    let cur = { choices: [] as ParamDef[], knobs: [] as ParamDef[] };
    for (const p of rest.filter((q) => q.group === g)) {
      const next = isKnob(p)
        ? { choices: cur.choices, knobs: [...cur.knobs, p] }
        : { choices: [...cur.choices, p], knobs: cur.knobs };
      if (units(next) > PAGE_UNITS && cur.choices.length + cur.knobs.length > 0) {
        parts.push(cur);
        cur = isKnob(p) ? { choices: [], knobs: [p] } : { choices: [p], knobs: [] };
      } else cur = next;
    }
    if (cur.choices.length + cur.knobs.length > 0) parts.push(cur);
    parts.forEach((part, i) =>
      pages.push({
        group: g,
        ...(parts.length > 1 ? { part: { index: i + 1, count: parts.length } } : {}),
        ...part,
      }),
    );
  }
  return { head, pages };
}

/** Height budget of a page: two rows of three knobs and one row of choices. */
export const PAGE_UNITS = 2.5;

function units(p: { choices: readonly ParamDef[]; knobs: readonly ParamDef[] }): number {
  return Math.ceil(p.knobs.length / 3) + p.choices.length / 2;
}
