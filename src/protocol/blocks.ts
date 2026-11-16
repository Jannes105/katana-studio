// Block tables (protocol-notes 2.12). A range RQ1 is answered with one DT1 per block; there is no end marker,
// so a request is complete once every expected block address has arrived (PLAN 4.2). Backups store raw bytes
// per block with the same boundaries (PLAN 4.6).

import { ADDR, PREVIEW_INDEX, SIZE, addr, storedPatchAddress, type Address } from './address';

export interface Block {
  /** Offset from the area base, linear. */
  readonly offset: number;
  readonly length: number;
}

/**
 * Expands rows of [b1, b2, count, length]: the first block sits at offset `b1 b2 00` (the notation of
 * protocol-notes 2.12, e.g. `01 04 00`), followed by `count - 1` more blocks every `02 00`.
 */
function rows(spec: readonly (readonly [number, number, number, number])[]): readonly Block[] {
  const out: Block[] = [];
  for (const [b1, b2, count, length] of spec) {
    const first = addr(0, b1, b2, 0);
    for (let i = 0; i < count; i++) out.push({ offset: first + i * addr(0, 0, 0x02, 0), length });
  }
  return out;
}

/** The 80 blocks of a patch (2649 data bytes), measured 2026-11-15. Same for the current and every stored patch. */
export const PATCH_BLOCKS: readonly Block[] = rows([
  [0x00, 0x00, 1, 16], // name
  [0x00, 0x02, 1, 3],
  [0x00, 0x04, 1, 5], // effect colours
  [0x00, 0x06, 1, 10], // amp
  [0x00, 0x08, 1, 6], // effect switches
  [0x00, 0x0a, 3, 8],
  [0x00, 0x10, 6, 1],
  [0x00, 0x1c, 6, 225],
  [0x00, 0x28, 6, 17],
  [0x00, 0x34, 3, 13],
  [0x00, 0x3a, 1, 2],
  [0x00, 0x3c, 1, 10],
  [0x00, 0x3e, 1, 14],
  [0x00, 0x40, 1, 1],
  [0x00, 0x42, 3, 2],
  [0x00, 0x48, 1, 3],
  [0x00, 0x4a, 1, 15],
  [0x00, 0x4c, 2, 3],
  [0x00, 0x50, 4, 11],
  [0x00, 0x58, 1, 3], // noise suppressor
  [0x00, 0x5a, 1, 5],
  [0x00, 0x5c, 1, 34],
  [0x00, 0x5e, 1, 1],
  [0x00, 0x60, 1, 34],
  [0x00, 0x62, 2, 49],
  [0x00, 0x66, 1, 2],
  [0x00, 0x68, 2, 3],
  [0x00, 0x6c, 2, 1],
  [0x00, 0x70, 2, 34],
  [0x00, 0x74, 4, 49],
  [0x00, 0x7c, 2, 1],
  [0x01, 0x00, 2, 34],
  [0x01, 0x04, 4, 49],
  [0x01, 0x0c, 2, 1],
  [0x01, 0x10, 2, 34],
  [0x01, 0x14, 4, 49],
  [0x01, 0x1c, 1, 5],
  [0x01, 0x1e, 1, 1],
]);

/** The 21 blocks of SYSTEM (131 data bytes), measured 2026-11-15. */
export const SYSTEM_BLOCKS: readonly Block[] = [
  1, 5, 2, 2, 2, 2, 11, 11, 11, 11, 11, 11, 3, 5, 5, 3, 1, 5, 1, 19, 9,
].map((length, i) => ({ offset: i * addr(0, 0, 0x02, 0), length }));

/** An area of the memory map with a known block layout. */
export interface Area {
  readonly name: string;
  readonly base: Address;
  readonly blocks: readonly Block[];
}

export const CURRENT_PATCH_AREA: Area = {
  name: 'current patch',
  base: ADDR.currentPatch,
  blocks: PATCH_BLOCKS,
};
export const SYSTEM_AREA: Area = { name: 'system', base: ADDR.system, blocks: SYSTEM_BLOCKS };

export function storedPatchArea(index: number): Area {
  return { name: `stored patch ${index}`, base: storedPatchAddress(index), blocks: PATCH_BLOCKS };
}

/** Every area with a known block layout: current patch, SYSTEM and the ten stored slots. */
export const KNOWN_AREAS: readonly Area[] = [
  CURRENT_PATCH_AREA,
  SYSTEM_AREA,
  ...Array.from({ length: PREVIEW_INDEX + 1 }, (_, i) => storedPatchArea(i)),
];

/** Total number of data bytes in a block list. */
export function totalLength(blocks: readonly Block[]): number {
  return blocks.reduce((sum, b) => sum + b.length, 0);
}

/**
 * Start addresses of all known blocks inside the range [start, start + size). This is the set of DT1 addresses
 * that completes a range RQ1. Returns an empty list if the range touches no known block (then the caller must
 * not wait for a block list, e.g. a single-byte read).
 */
export function expectedBlockAddresses(start: Address, size: number): Address[] {
  const end = start + size;
  const out: Address[] = [];
  for (const area of KNOWN_AREAS) {
    for (const b of area.blocks) {
      const a = area.base + b.offset;
      if (a >= start && a < end) out.push(a);
    }
  }
  return out.sort((x, y) => x - y);
}

/** The block (with its area) that starts exactly at this address, if any. */
export function blockAt(a: Address): { area: Area; block: Block } | undefined {
  for (const area of KNOWN_AREAS) {
    const offset = a - area.base;
    if (offset < 0) continue;
    const block = area.blocks.find((b) => b.offset === offset);
    if (block) return { area, block };
  }
  return undefined;
}

/** Range size covering one whole patch (= SIZE.patch). */
export const PATCH_RANGE_SIZE = SIZE.patch;
