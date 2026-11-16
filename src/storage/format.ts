// Our own patch and backup file format (PLAN 4.6), JSON:
//
//   {
//     "format": "katana-studio", "kind": "backup" | "patch", "formatVersion": 1,
//     "createdAt": ISO time, "appVersion": "0.1.0",
//     "model": { "code": 6, "name": "KATANA-100" }, "firmware": null, "memo": "",
//     "system":  { "000000": "01", "000200": "0000000000", … },          (backup only)
//     "slots":   { "1": { "channel": "A1", "name": "…", "blocks": { "000000": "4B41…", … } }, … },   (backup only)
//     "current": { "channel": "A1", "name": "…", "blocks": { … } }      (backup: the edit buffer; patch: the patch)
//   }
//
// Content is raw bytes per device block, hex without spaces, keyed by the stable block key (offset from the area
// base, `blockKey`). Raw bytes stay valid whatever our parameter list says, and convert directly to .tsl later
// (also raw bytes per block). Names are plain text for people; the bytes are what counts.

import { PATCH_SLOT_NAMES, PREVIEW_INDEX, isPatchIndex } from '../protocol/address';
import { PATCH_BLOCKS, SYSTEM_BLOCKS, type Block } from '../protocol/blocks';
import { patchName } from '../protocol/encoding';

export const FORMAT_ID = 'katana-studio';
export const FORMAT_VERSION = 1;

/** Raw bytes of one area (a patch or SYSTEM), by block key. */
export type BlockBytes = ReadonlyMap<string, readonly number[]>;

export interface PatchEntry {
  /** Channel label as shown ("A1", "Panel"); informational. */
  readonly channel: string;
  /** Patch name as text; informational (the name block holds the real bytes). */
  readonly name: string;
  readonly blocks: BlockBytes;
}

interface FileBase {
  readonly createdAt: string;
  readonly appVersion: string;
  readonly model: { readonly code: number; readonly name: string };
  /** Not readable from the amp so far (protocol-notes Q7). */
  readonly firmware: string | null;
  readonly memo: string;
}

export interface BackupFile extends FileBase {
  readonly kind: 'backup';
  readonly system: BlockBytes;
  /** Stored slots by patch index 0–8 (Panel and A1–B4; never the PREVIEW slot). */
  readonly slots: ReadonlyMap<number, PatchEntry>;
  /** The current patch (edit buffer), possibly unsaved. */
  readonly current: PatchEntry;
}

export interface PatchFile extends FileBase {
  readonly kind: 'patch';
  readonly current: PatchEntry;
}

export type KatanaFile = BackupFile | PatchFile;

export class FileFormatError extends Error {
  constructor(message: string) {
    super(`Not a valid Katana Studio file: ${message}`);
    this.name = 'FileFormatError';
  }
}

/** The slot indexes a complete backup holds: Panel and A1–B4. */
export const BACKUP_SLOT_INDEXES: readonly number[] = Array.from({ length: PREVIEW_INDEX }, (_, i) => i);

export function channelLabel(index: number | null): string {
  return index !== null && isPatchIndex(index) ? PATCH_SLOT_NAMES[index] : '–';
}

/** The patch name from the raw name block, or '' if it is missing. */
export function nameFromBlocks(blocks: BlockBytes): string {
  const bytes = blocks.get(PATCH_BLOCKS[0]?.key ?? '000000');
  return bytes && bytes.length === 16 ? patchName.decode(bytes) : '';
}

/** True when every block of the layout is present with the right length. */
export function isComplete(blocks: BlockBytes, layout: readonly Block[]): boolean {
  return layout.every((b) => blocks.get(b.key)?.length === b.length) && blocks.size === layout.length;
}

// ---- writing ----

const hexOf = (bytes: readonly number[]): string =>
  bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');

function blocksJson(blocks: BlockBytes, layout: readonly Block[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of layout) {
    const bytes = blocks.get(b.key);
    if (bytes) out[b.key] = hexOf(bytes);
  }
  return out;
}

function entryJson(e: PatchEntry): object {
  return { channel: e.channel, name: e.name, blocks: blocksJson(e.blocks, PATCH_BLOCKS) };
}

/** Serialises a file; blocks in device order, so two backups of the same amp give the same text. */
export function toJson(file: KatanaFile): string {
  const head = {
    format: FORMAT_ID,
    kind: file.kind,
    formatVersion: FORMAT_VERSION,
    createdAt: file.createdAt,
    appVersion: file.appVersion,
    model: file.model,
    firmware: file.firmware,
    memo: file.memo,
  };
  const body =
    file.kind === 'backup'
      ? {
          system: blocksJson(file.system, SYSTEM_BLOCKS),
          slots: Object.fromEntries(
            [...file.slots].sort((a, b) => a[0] - b[0]).map(([i, e]) => [String(i), entryJson(e)]),
          ),
          current: entryJson(file.current),
        }
      : { current: entryJson(file.current) };
  return `${JSON.stringify({ ...head, ...body }, null, 1)}\n`;
}

// ---- reading ----

function obj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new FileFormatError(`${what} missing`);
  return v as Record<string, unknown>;
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new FileFormatError(`${what} missing`);
  return v;
}

function parseBlocks(v: unknown, layout: readonly Block[], what: string): BlockBytes {
  const raw = obj(v, what);
  const byKey = new Map(layout.map((b) => [b.key, b]));
  const out = new Map<string, number[]>();
  for (const [key, hex] of Object.entries(raw)) {
    const b = byKey.get(key);
    if (!b) throw new FileFormatError(`${what}: unknown block ${key}`);
    if (typeof hex !== 'string' || !/^([0-9A-Fa-f]{2})*$/.test(hex))
      throw new FileFormatError(`${what} ${key}: not hex`);
    const bytes = (hex.match(/../g) ?? []).map((h) => parseInt(h, 16));
    if (bytes.length !== b.length)
      throw new FileFormatError(`${what} ${key}: ${bytes.length} bytes, expected ${b.length}`);
    if (bytes.some((x) => x > 0x7f)) throw new FileFormatError(`${what} ${key}: byte above 7F`);
    out.set(key, bytes);
  }
  return out;
}

function parseEntry(v: unknown, what: string): PatchEntry {
  const o = obj(v, what);
  const blocks = parseBlocks(o.blocks, PATCH_BLOCKS, `${what} blocks`);
  return {
    channel: typeof o.channel === 'string' ? o.channel : '',
    name: typeof o.name === 'string' ? o.name : nameFromBlocks(blocks),
    blocks,
  };
}

/** Parses and checks a file. Throws FileFormatError with a readable reason. */
export function parseFile(text: string): KatanaFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FileFormatError('not JSON');
  }
  const o = obj(raw, 'file');
  if (o.format !== FORMAT_ID) throw new FileFormatError('format id missing');
  if (o.formatVersion !== FORMAT_VERSION)
    throw new FileFormatError(`format version ${String(o.formatVersion)} is not supported`);
  const model = obj(o.model, 'model');
  if (typeof model.code !== 'number') throw new FileFormatError('model code missing');
  const base: FileBase = {
    createdAt: str(o.createdAt, 'createdAt'),
    appVersion: str(o.appVersion, 'appVersion'),
    model: { code: model.code, name: typeof model.name === 'string' ? model.name : '' },
    firmware: typeof o.firmware === 'string' ? o.firmware : null,
    memo: typeof o.memo === 'string' ? o.memo : '',
  };
  const current = parseEntry(o.current, 'current');
  if (o.kind === 'patch') return { ...base, kind: 'patch', current };
  if (o.kind !== 'backup') throw new FileFormatError(`unknown kind ${String(o.kind)}`);

  const slots = new Map<number, PatchEntry>();
  for (const [k, v] of Object.entries(obj(o.slots, 'slots'))) {
    const index = Number(k);
    if (!BACKUP_SLOT_INDEXES.includes(index)) throw new FileFormatError(`slot ${k} is not allowed`);
    slots.set(index, parseEntry(v, `slot ${k}`));
  }
  return { ...base, kind: 'backup', system: parseBlocks(o.system, SYSTEM_BLOCKS, 'system'), slots, current };
}

/** True when two files hold the same raw bytes (time, app version and memo ignored). */
export function sameBytes(a: KatanaFile, b: KatanaFile): boolean {
  const strip = (f: KatanaFile): string =>
    toJson({ ...f, createdAt: '', appVersion: '', memo: '' } as KatanaFile);
  return strip(a) === strip(b);
}
