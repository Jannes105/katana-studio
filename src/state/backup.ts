// Complete backup (PLAN 4.6): SYSTEM, the stored slots Panel and A1–B4, and the current patch, each with one
// range request (about 3 s on the amp). Read-only. Anything incomplete or cancelled fails as a whole, so there
// is never half a file.

import { ADDR, SIZE, storedPatchAddress, storedPatchIndexOf, type Address } from '../protocol/address';
import { PATCH_BLOCKS, SYSTEM_BLOCKS, blockKey, type Block } from '../protocol/blocks';
import type { ReadReply } from '../protocol/queue';
import type { PatchImage } from '../model/patch';
import {
  BACKUP_SLOT_INDEXES,
  channelLabel,
  isComplete,
  nameFromBlocks,
  type BackupFile,
  type BlockBytes,
  type PatchEntry,
  type PatchFile,
} from '../storage/format';

export interface FileMeta {
  readonly createdAt: string;
  readonly appVersion: string;
  readonly model: { readonly code: number; readonly name: string };
  readonly memo?: string;
}

export interface BackupLink {
  read(address: Address, size: number): Promise<ReadReply>;
}

export class BackupIncompleteError extends Error {
  constructor(what: string) {
    super(`Backup incomplete: ${what}`);
    this.name = 'BackupIncompleteError';
  }
}

/** Range covering the stored slots Panel and A1–B4, ending before the PREVIEW slot (PLAN 4.6). */
export const BACKUP_SLOTS_SIZE = SIZE.storedPatchStride * BACKUP_SLOT_INDEXES.length;

/** DT1 of a reply that are whole blocks of an area, keyed by block key. */
function areaBlocks(reply: ReadonlyMap<Address, readonly number[]>, base: Address, layout: readonly Block[]) {
  const byOffset = new Map(layout.map((b) => [b.offset, b]));
  const out = new Map<string, readonly number[]>();
  for (const [a, data] of reply) {
    const b = byOffset.get(a - base);
    if (b && data.length === b.length) out.set(b.key, [...data]);
  }
  return out;
}

function entry(index: number | null, blocks: BlockBytes): PatchEntry {
  return { channel: channelLabel(index), name: nameFromBlocks(blocks), blocks };
}

/** Reads a complete backup. `currentIndex` is the channel of the edit buffer (for the label only). */
export async function readBackup(
  link: BackupLink,
  currentIndex: number | null,
  meta: FileMeta,
): Promise<BackupFile> {
  const system = await link.read(ADDR.system, SIZE.system);
  const slotsReply = await link.read(ADDR.storedPatchBase, BACKUP_SLOTS_SIZE);
  const current = await link.read(ADDR.currentPatch, SIZE.patch);

  const systemBlocks = areaBlocks(system.blocks, ADDR.system, SYSTEM_BLOCKS);
  if (!isComplete(systemBlocks, SYSTEM_BLOCKS)) throw new BackupIncompleteError('SYSTEM');

  const slots = new Map<number, PatchEntry>();
  for (const index of BACKUP_SLOT_INDEXES) {
    const base = storedPatchAddress(index);
    const own = new Map([...slotsReply.blocks].filter(([a]) => storedPatchIndexOf(a) === index));
    const blocks = areaBlocks(own, base, PATCH_BLOCKS);
    if (!isComplete(blocks, PATCH_BLOCKS)) throw new BackupIncompleteError(`slot ${channelLabel(index)}`);
    slots.set(index, entry(index, blocks));
  }

  const currentBlocks = areaBlocks(current.blocks, ADDR.currentPatch, PATCH_BLOCKS);
  if (!isComplete(currentBlocks, PATCH_BLOCKS)) throw new BackupIncompleteError('current patch');

  return {
    kind: 'backup',
    ...meta,
    memo: meta.memo ?? '',
    firmware: null,
    system: systemBlocks,
    slots,
    current: entry(currentIndex, currentBlocks),
  };
}

/** A patch file from the mirrored current patch (no read needed). */
export function patchFileFrom(image: PatchImage, index: number | null, meta: FileMeta): PatchFile {
  const blocks = new Map(image.entries().map(([offset, data]) => [blockKey(offset), data]));
  if (!isComplete(blocks, PATCH_BLOCKS)) throw new BackupIncompleteError('current patch not read yet');
  return { kind: 'patch', ...meta, memo: meta.memo ?? '', firmware: null, current: entry(index, blocks) };
}
