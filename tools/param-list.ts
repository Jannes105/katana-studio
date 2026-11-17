// Writes our parameter list (src/model) as plain JSON rows for tools/katana-probe.ps1 -ParamTest, so the probe
// checks exactly the addresses the app knows. Run with `npm run params:export` (bundled by rolldown, then run
// by node); the output tools/param-list.json is generated and git-ignored.
//
// Offsets are linear from the patch base (PLAN 4.2: 7-bit math happens in the probe). Parameters of a variation
// carry the colour byte, the switch and the three blocks, so the probe can test them in the active variation.

import { writeFileSync } from 'node:fs';
import { CONTOUR_SELECT, DELAY2, EFFECTS, PATCH_PARAMS, contourFreqShift } from '../src/model/params';
import { contourType, eqType, PEDAL_FX_TYPE } from '../src/model/sections';
import { encodingSize, type ParamDef, type VariantGroup } from '../src/model/schema';
import { SYSTEM_PARAMS, globalEqType } from '../src/model/system';

interface Row {
  key: string;
  kind: 'switch' | 'select' | 'knob';
  size: number;
  min: number;
  max: number;
  status: string;
  /** 'system': `at` is from the SYSTEM base 10 00 00 00 (katana-probe.ps1 -System); otherwise the patch. */
  area?: 'system';
  /** Fixed offset (patch parameters). */
  at?: number;
  /** Parameter of a variation: byte inside the block of the active variation. */
  variant?: { effect: string; colourAt: number; switchAt: number; blocks: number[]; typeBlocks: number[]; byte: number };
  /** Contour 1–3 parameter: byte inside the block of the selected contour (skipped when contour is off). */
  contour?: { selectAt: number; blocks: number[]; byte: number };
  /** Shown only for these types; the type is read at typeAt (patch parameters) or from the type block. */
  types?: number[];
  typeAt?: number;
}

const kind = (p: ParamDef): Row['kind'] =>
  p.control === 'switch' ? 'switch' : p.control === 'leds' || p.display?.table ? 'select' : 'knob';

function base(p: ParamDef): Row {
  const r: Row = { key: p.key, kind: kind(p), size: encodingSize(p.encoding), min: p.min, max: p.max, status: p.status };
  if (p.visibleFor) r.types = [...p.visibleFor];
  return r;
}

/** Patch parameters whose visibility follows another parameter (pedal FX, EQ 1, EQ 2). */
const TYPE_OF: [RegExp, ParamDef][] = [
  [/^pedalFx\./, PEDAL_FX_TYPE],
  [/^eq1\./, eqType(1)],
  [/^eq2\./, eqType(2)],
];

const contourKeys = new Set([1, 2, 3].flatMap((c) => [contourFreqShift(c as 1).key, contourType(c as 1).key]));
const rows: Row[] = [];

for (const p of PATCH_PARAMS) {
  if (p.encoding === 'ascii16' || p.readonly) continue;
  if (contourKeys.has(p.key)) continue; // tested once, in the selected contour (below)
  const r = { ...base(p), at: p.at };
  const t = TYPE_OF.find(([re]) => re.test(p.key))?.[1];
  if (r.types && t) r.typeAt = t.at;
  rows.push(r);
}

const blocks = [1, 2, 3].map((c) => contourFreqShift(c as 1).at - 1);
for (const [key, def] of [
  ['contour.type', contourType(1)],
  ['contour.freqShift', contourFreqShift(1)],
] as const) {
  rows.push({ ...base(def), key, contour: { selectAt: CONTOUR_SELECT.at, blocks, byte: def.at - (blocks[0] ?? 0) } });
}

function variantRows(g: VariantGroup): void {
  for (const p of g.params) {
    if (p.readonly) continue;
    rows.push({
      ...base(p),
      key: `${g.key}.${p.key}`,
      variant: {
        effect: g.key,
        colourAt: g.colour.at,
        switchAt: g.switch.at,
        blocks: [...g.paramBlocks],
        typeBlocks: [...g.typeBlocks],
        byte: p.at,
      },
    });
  }
}
for (const g of [...EFFECTS, DELAY2]) variantRows(g);

// SYSTEM (Phase 3): fixed offsets from the SYSTEM base; global EQ memory m shows PEQ or GE-10 by its type.
for (const p of SYSTEM_PARAMS) {
  const r: Row = { ...base(p), area: 'system', at: p.at };
  const m = /^system.globalEq.([123])./.exec(p.key)?.[1];
  if (r.types && m) r.typeAt = globalEqType(Number(m) as 1 | 2 | 3).at;
  rows.push(r);
}

const out = process.argv[2] ?? 'tools/param-list.json';
writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), rows }, null, 1));
console.log(`${rows.length} parameters written to ${out}`);
