// A patch as raw bytes per block (PLAN 4.5/4.6: the state keeps raw bytes, the model decodes from them), and the
// decoded view of what Phase 1a shows.

import type { Address } from '../protocol/address';
import { PATCH_BLOCKS, type Block } from '../protocol/blocks';
import { patchName, u4x4, u7 } from '../protocol/encoding';
import {
  AMP_KNOBS,
  AMP_TYPE,
  AMP_VARIATION,
  EFFECTS,
  NS_RELEASE,
  NS_SWITCH,
  NS_THRESHOLD,
  PATCH_NAME,
  effectType,
} from './params';
import { encodingSize, type ParamDef, type VariantGroup } from './schema';

const BY_OFFSET = new Map<number, Block>(PATCH_BLOCKS.map((b) => [b.offset, b]));

const NAME_REPLACEMENTS: Readonly<Record<string, string>> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ß: 'ss',
};

/**
 * Text the amp can store as a patch name (protocol-notes 2.8: 16 characters 32–125; the amp itself turns
 * anything else into a space). German umlauts become two letters, other characters are dropped, the rest is cut
 * to 16 characters. Trailing spaces are removed (the encoding pads them again).
 */
export function patchNameFrom(text: string): string {
  let out = '';
  for (const ch of text) {
    const r = NAME_REPLACEMENTS[ch] ?? ch;
    for (const c of r) {
      const code = c.charCodeAt(0);
      if (c.length === 1 && code >= 32 && code <= 125) out += c;
    }
  }
  return out.slice(0, 16).trimEnd();
}

/** The patch block that contains this offset (linear, from the patch base). */
export function patchBlockAt(offset: Address): Block | undefined {
  for (const b of PATCH_BLOCKS) if (offset >= b.offset && offset < b.offset + b.length) return b;
  return undefined;
}

/**
 * Raw bytes of one patch, by block offset (linear, from the patch base). Immutable: `with` returns a copy.
 * Blocks may be missing (not read yet); reading from them gives undefined.
 */
export class PatchImage {
  private constructor(private readonly blocks: ReadonlyMap<Address, readonly number[]>) {}

  static readonly EMPTY = new PatchImage(new Map());

  /** From blocks already keyed by their offset from the patch base. */
  static of(blocks: ReadonlyMap<Address, readonly number[]>): PatchImage {
    return PatchImage.fromReply(blocks, 0);
  }

  /**
   * From the DT1 of a range read (absolute addresses, as in ReadReply.blocks) of a patch at `base`. Messages
   * that are no known patch block or have the wrong length are left out.
   */
  static fromReply(blocks: ReadonlyMap<Address, readonly number[]>, base: Address): PatchImage {
    const out = new Map<Address, readonly number[]>();
    for (const [a, data] of blocks) {
      const b = BY_OFFSET.get(a - base);
      if (b && data.length === b.length) out.set(b.offset, [...data]);
    }
    return new PatchImage(out);
  }

  /** Number of blocks present (80 = complete). */
  get size(): number {
    return this.blocks.size;
  }

  get complete(): boolean {
    return this.blocks.size === PATCH_BLOCKS.length;
  }

  block(offset: Address): readonly number[] | undefined {
    return this.blocks.get(offset);
  }

  /** `length` bytes from `offset`, within one block; undefined if that block is missing. */
  read(offset: Address, length: number): readonly number[] | undefined {
    const b = patchBlockAt(offset);
    if (!b || offset + length > b.offset + b.length) return undefined;
    const data = this.blocks.get(b.offset);
    return data?.slice(offset - b.offset, offset - b.offset + length);
  }

  /**
   * A copy with `data` written at `offset` (a report or write of single values, or a whole block). Bytes that
   * fall outside the block, or into a block not read yet, are ignored.
   */
  with(offset: Address, data: readonly number[]): PatchImage {
    const b = patchBlockAt(offset);
    const old = b ? this.blocks.get(b.offset) : undefined;
    if (!b || !old) return this;
    const start = offset - b.offset;
    const next = [...old];
    for (let i = 0; i < data.length && start + i < b.length; i++) next[start + i] = data[i] ?? 0;
    const blocks = new Map(this.blocks);
    blocks.set(b.offset, next);
    return new PatchImage(blocks);
  }

  /** Offsets of every byte that differs from `other` (missing blocks are not compared). */
  diff(other: PatchImage): Address[] {
    const out: Address[] = [];
    for (const [offset, data] of this.blocks) {
      const o = other.blocks.get(offset);
      if (!o) continue;
      data.forEach((v, i) => {
        if (o[i] !== v) out.push(offset + i);
      });
    }
    return out;
  }

  /** All blocks, ascending (for the file format and tests). */
  entries(): [Address, readonly number[]][] {
    return [...this.blocks].sort((a, b) => a[0] - b[0]);
  }
}

/** Raw value of a parameter; `base` is added to its offset (instance block of a VariantGroup parameter). */
export function readRaw(image: PatchImage, def: ParamDef, base: Address = 0): number | undefined {
  const bytes = image.read(base + def.at, encodingSize(def.encoding));
  if (!bytes) return undefined;
  switch (def.encoding) {
    case 'u7':
      return u7.decode(bytes);
    case 'u4x4':
      return u4x4.decode(bytes);
    case 'ascii16':
      return undefined; // text: see readText
  }
}

export function readText(image: PatchImage, def: ParamDef): string | undefined {
  if (def.encoding !== 'ascii16') return undefined;
  const bytes = image.read(def.at, 16);
  return bytes ? patchName.decode(bytes) : undefined;
}

/** A raw value as the UI shows it: table name, or the number after offset and factor, with unit. */
export function formatValue(def: ParamDef, raw: number): string {
  const d = def.display;
  if (d?.table) return d.table[raw] ?? `${def.label} ${raw}`;
  const n = (raw - (d?.rawOffset ?? 0)) * (d?.factor ?? 1);
  const shown = d?.decimals !== undefined ? n.toFixed(d.decimals) : String(n);
  return d?.unit ? `${shown} ${d.unit}` : shown;
}

// ---- What Phase 1a shows ----

export interface EffectView {
  readonly key: VariantGroup['key'];
  readonly label: string;
  readonly on: boolean | undefined;
  /** Active variation 0–2. */
  readonly colour: number | undefined;
  /** Type of each variation (raw), by colour. */
  readonly types: readonly (number | undefined)[];
  /** Name of each variation's type ("Type n" while our table is missing). */
  readonly typeNames: readonly (string | undefined)[];
}

export interface PatchView {
  readonly name: string | undefined;
  /** Raw values of the patch parameters, by key. Missing when the block was not read. */
  readonly values: ReadonlyMap<string, number>;
  readonly effects: readonly EffectView[];
}

export function typeName(g: VariantGroup, raw: number): string {
  return g.typeNames[raw] ?? `Type ${raw}`;
}

export function effectView(image: PatchImage, g: VariantGroup): EffectView {
  const types = [0, 1, 2].map((c) => readRaw(image, effectType(g, c)));
  const on = readRaw(image, g.switch);
  return {
    key: g.key,
    label: g.label,
    on: on === undefined ? undefined : on !== 0,
    colour: readRaw(image, g.colour),
    types,
    typeNames: types.map((t) => (t === undefined ? undefined : typeName(g, t))),
  };
}

const VIEW_PARAMS: readonly ParamDef[] = [
  ...AMP_KNOBS,
  AMP_TYPE,
  AMP_VARIATION,
  NS_SWITCH,
  NS_THRESHOLD,
  NS_RELEASE,
];

export function patchView(image: PatchImage): PatchView {
  const values = new Map<string, number>();
  for (const def of VIEW_PARAMS) {
    const v = readRaw(image, def);
    if (v !== undefined) values.set(def.key, v);
  }
  return { name: readText(image, PATCH_NAME), values, effects: EFFECTS.map((g) => effectView(image, g)) };
}
