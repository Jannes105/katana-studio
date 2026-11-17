// Patches a file offers for loading into a channel (PLAN 1c: restore): our backup (Panel, A1–B4 and the current
// patch), our patch file, or a Gen 3 .tsl from BOSS Tone Studio. Only complete patches (all 80 blocks with the
// right length, every byte 0–127) can be loaded; incomplete ones are listed but marked.

import { PATCH_BLOCKS } from '../protocol/blocks';
import { FileFormatError, isComplete, nameFromBlocks, parseFile, type BlockBytes } from './format';
import { TSL_DEVICE, fromTsl } from './tsl';

export interface PatchSourceEntry {
  /** Where the patch comes from: the channel label of a slot ("A1", "Panel"), or the position in a .tsl ("3"). */
  readonly label: string;
  /** True for the current patch (edit buffer) of a backup or a patch file. */
  readonly current: boolean;
  readonly name: string;
  readonly blocks: BlockBytes;
  /** True when it can be loaded (all blocks present and valid). */
  readonly complete: boolean;
}

export interface PatchSource {
  readonly kind: 'backup' | 'patch' | 'tsl';
  readonly patches: readonly PatchSourceEntry[];
}

function valid(blocks: BlockBytes): boolean {
  return (
    isComplete(blocks, PATCH_BLOCKS) &&
    [...blocks.values()].every((b) => b.every((v) => Number.isInteger(v) && v >= 0 && v <= 0x7f))
  );
}

function entry(label: string, current: boolean, blocks: BlockBytes, name?: string): PatchSourceEntry {
  return { label, current, name: name || nameFromBlocks(blocks), blocks, complete: valid(blocks) };
}

/** Reads the patches of a file. Throws FileFormatError when the file is neither of our formats nor a .tsl. */
export function readPatchSource(text: string): PatchSource {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FileFormatError('not JSON');
  }
  if (raw !== null && typeof raw === 'object' && (raw as { device?: unknown }).device === TSL_DEVICE) {
    const tsl = fromTsl(text);
    return {
      kind: 'tsl',
      patches: tsl.patches.map((p, i) => entry(String(i + 1), false, p.blocks)),
    };
  }
  const file = parseFile(text);
  if (file.kind === 'patch') {
    return {
      kind: 'patch',
      patches: [entry(file.current.channel, true, file.current.blocks, file.current.name)],
    };
  }
  const slots = [...file.slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, e]) => entry(e.channel, false, e.blocks, e.name));
  return {
    kind: 'backup',
    patches: [...slots, entry(file.current.channel, true, file.current.blocks, file.current.name)],
  };
}
