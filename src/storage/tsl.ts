// Export as a Gen 3 .tsl file, the format BOSS Tone Studio imports into its librarian (PLAN 4.6: a tested way back
// long before Phase 4, and the best check of our block layout).
//
// Layout (from local analysis, protocol-notes 2.14): JSON
//   { "name": "...", "formatRev": "0000", "device": "KATANA Gen3",
//     "data": [[ { "memo": { "memo": "", "isToneCentralPatch": false },
//                  "paramSet": { "PATCH%COM": ["4B", "41", …], "PATCH%OTHER": […], … } }, … ]] }
// One entry per patch; each block of the patch under its name, as two-digit hex strings. The 80 block names map
// one to one onto our block table (same offsets).

import { PATCH_BLOCKS } from '../protocol/blocks';
import type { BlockBytes } from './format';

export const TSL_DEVICE = 'KATANA Gen3';
export const TSL_FORMAT_REV = '0000';

/** Block name in a .tsl file, by our block key (our own table; offsets as in protocol-notes 2.12). */
const NAMES_IN_ORDER = [
  'COM',
  'OTHER',
  'COLOR',
  'AMP',
  'SW',
  'BOOSTER(1)',
  'BOOSTER(2)',
  'BOOSTER(3)',
  'FX(1)',
  'FX(2)',
  'FX(3)',
  'FX(4)',
  'FX(5)',
  'FX(6)',
  'FX_DETAIL(1)',
  'FX_DETAIL(2)',
  'FX_DETAIL(3)',
  'FX_DETAIL(4)',
  'FX_DETAIL(5)',
  'FX_DETAIL(6)',
  'DELAY(1)',
  'DELAY(2)',
  'DELAY(3)',
  'DELAY(4)',
  'DELAY(5)',
  'DELAY(6)',
  'REVERB(1)',
  'REVERB(2)',
  'REVERB(3)',
  'SOLO_COM',
  'SOLO_EQ',
  'SOLO_DELAY',
  'CONTOUR_COM',
  'CONTOUR(1)',
  'CONTOUR(2)',
  'CONTOUR(3)',
  'PEDALFX_COM',
  'PEDALFX',
  'EQ_EACH(1)',
  'EQ_EACH(2)',
  'EQ_PEQ(1)',
  'EQ_PEQ(2)',
  'EQ_GE10(1)',
  'EQ_GE10(2)',
  'NS',
  'SENDRETURN',
  'ASSIGN_KNOBS',
  'ASSIGN_EXPPDL_FUNC',
  'ASSIGN_EXPPDL_DETAIL',
  'ASSIGN_EXPPDL_MIN',
  'ASSIGN_EXPPDL_MAX',
  'ASSIGN_FS',
  'ASSIGN_GAFCFS(1)',
  'ASSIGN_GAFCFS(2)',
  'ASSIGN_GAFCEXPPDL1_FUNC(1)',
  'ASSIGN_GAFCEXPPDL1_FUNC(2)',
  'ASSIGN_GAFCEXPPDL1_DETAIL(1)',
  'ASSIGN_GAFCEXPPDL1_DETAIL(2)',
  'ASSIGN_GAFCEXPPDL1_MIN(1)',
  'ASSIGN_GAFCEXPPDL1_MIN(2)',
  'ASSIGN_GAFCEXPPDL1_MAX(1)',
  'ASSIGN_GAFCEXPPDL1_MAX(2)',
  'ASSIGN_GAFCEXPPDL2_FUNC(1)',
  'ASSIGN_GAFCEXPPDL2_FUNC(2)',
  'ASSIGN_GAFCEXPPDL2_DETAIL(1)',
  'ASSIGN_GAFCEXPPDL2_DETAIL(2)',
  'ASSIGN_GAFCEXPPDL2_MIN(1)',
  'ASSIGN_GAFCEXPPDL2_MIN(2)',
  'ASSIGN_GAFCEXPPDL2_MAX(1)',
  'ASSIGN_GAFCEXPPDL2_MAX(2)',
  'ASSIGN_GAFCEXPPDL3_FUNC(1)',
  'ASSIGN_GAFCEXPPDL3_FUNC(2)',
  'ASSIGN_GAFCEXPPDL3_DETAIL(1)',
  'ASSIGN_GAFCEXPPDL3_DETAIL(2)',
  'ASSIGN_GAFCEXPPDL3_MIN(1)',
  'ASSIGN_GAFCEXPPDL3_MIN(2)',
  'ASSIGN_GAFCEXPPDL3_MAX(1)',
  'ASSIGN_GAFCEXPPDL3_MAX(2)',
  'PATCH_KNOB_READONLY',
  'PATCH_KNOB_SOLO_DELAY_READONLY',
] as const;

if (NAMES_IN_ORDER.length !== PATCH_BLOCKS.length)
  throw new Error('.tsl block names do not match the block table');

export const TSL_BLOCK_NAMES: ReadonlyMap<string, string> = new Map(
  PATCH_BLOCKS.map((b, i) => [b.key, `PATCH%${NAMES_IN_ORDER[i] ?? ''}`]),
);

export interface TslPatch {
  readonly memo?: string;
  readonly blocks: BlockBytes;
}

const hex2 = (b: number): string => b.toString(16).padStart(2, '0').toUpperCase();

/** A .tsl "live set" with the given patches in order (BTS shows them as its patch list). */
export function toTsl(name: string, patches: readonly TslPatch[]): string {
  const data = patches.map((p) => {
    const paramSet: Record<string, string[]> = {};
    for (const b of PATCH_BLOCKS) {
      const bytes = p.blocks.get(b.key);
      const tslName = TSL_BLOCK_NAMES.get(b.key);
      if (!bytes || !tslName) throw new Error(`Block ${b.key} missing for .tsl`);
      paramSet[tslName] = bytes.map(hex2);
    }
    return { memo: { memo: p.memo ?? '', isToneCentralPatch: false }, paramSet };
  });
  return JSON.stringify({ name, formatRev: TSL_FORMAT_REV, device: TSL_DEVICE, data: [data] });
}

/** Reads the patches of a Gen 3 .tsl back into raw blocks (for tests now, import in Phase 4). */
export function fromTsl(text: string): { name: string; patches: TslPatch[] } {
  const o = JSON.parse(text) as {
    name?: unknown;
    device?: unknown;
    data?: { memo?: { memo?: unknown }; paramSet?: Record<string, unknown> }[][];
  };
  if (o.device !== TSL_DEVICE) throw new Error(`Not a ${TSL_DEVICE} .tsl file`);
  const patches = (o.data?.[0] ?? []).map((entry) => {
    const blocks = new Map<string, number[]>();
    for (const b of PATCH_BLOCKS) {
      const values = entry.paramSet?.[TSL_BLOCK_NAMES.get(b.key) ?? ''];
      if (!Array.isArray(values)) continue;
      blocks.set(
        b.key,
        values.slice(0, b.length).map((v) => parseInt(String(v), 16)),
      );
    }
    const memo = typeof entry.memo?.memo === 'string' ? entry.memo.memo : '';
    return { memo, blocks };
  });
  return { name: typeof o.name === 'string' ? o.name : '', patches };
}
