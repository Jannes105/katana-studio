import { describe, expect, it } from 'vitest';
import { PATCH_BLOCKS, SYSTEM_BLOCKS } from '../../src/protocol/blocks';
import { patchName } from '../../src/protocol/encoding';
import { BACKUP_SLOT_INDEXES, FileFormatError, toJson, type PatchEntry } from '../../src/storage/format';
import { readPatchSource } from '../../src/storage/sources';
import { toTsl } from '../../src/storage/tsl';

function patch(channel: string, name: string, fill = 1): PatchEntry {
  const blocks = new Map(PATCH_BLOCKS.map((b) => [b.key, new Array<number>(b.length).fill(fill)]));
  blocks.set('000000', patchName.encode(name));
  return { channel, name, blocks };
}

const meta = {
  createdAt: '2026-11-17T12:00:00.000Z',
  appVersion: '0.4.0',
  model: { code: 6, name: 'KATANA-100' },
  firmware: null,
  memo: '',
};

describe('patches a file offers for loading (PLAN 1c)', () => {
  it('a backup offers Panel, A1–B4 and the current patch, in that order', () => {
    const text = toJson({
      kind: 'backup',
      ...meta,
      system: new Map(SYSTEM_BLOCKS.map((b) => [b.key, new Array<number>(b.length).fill(0)])),
      slots: new Map(BACKUP_SLOT_INDEXES.map((i) => [i, patch(i === 0 ? 'Panel' : `C${i}`, `P${i}`)])),
      current: patch('B2', 'NOW'),
    });
    const source = readPatchSource(text);
    expect(source.kind).toBe('backup');
    expect(source.patches.map((p) => `${p.label}:${p.name}:${p.current}`)).toEqual([
      'Panel:P0:false',
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `C${i}:P${i}:false`),
      'B2:NOW:true',
    ]);
    expect(source.patches.every((p) => p.complete)).toBe(true);
  });

  it('a patch file offers its one patch', () => {
    const source = readPatchSource(toJson({ kind: 'patch', ...meta, current: patch('A3', 'Lead') }));
    expect(source.kind).toBe('patch');
    expect(source.patches).toHaveLength(1);
    expect(source.patches[0]).toMatchObject({ label: 'A3', name: 'Lead', complete: true });
  });

  it('a .tsl offers its patches by position; incomplete ones are marked', () => {
    const full = patch('', 'FULL').blocks;
    const text = toTsl('Set', [{ blocks: full }, { blocks: patch('', 'TWO', 2).blocks }]);
    // BOSS Tone Studio fills missing blocks itself on import; a file without them cannot be loaded by us.
    const o = JSON.parse(text) as { data: { paramSet: Record<string, unknown> }[][] };
    const second = o.data[0]?.[1];
    if (second) delete second.paramSet['PATCH%NS'];
    const source = readPatchSource(JSON.stringify(o));
    expect(source.kind).toBe('tsl');
    expect(source.patches.map((p) => [p.label, p.name, p.complete])).toEqual([
      ['1', 'FULL', true],
      ['2', 'TWO', false],
    ]);
  });

  it('bytes above 127 make a patch incomplete', () => {
    const text = toTsl('Set', [{ blocks: patch('', 'X').blocks }]);
    const broken = text.replace('"PATCH%NS":["01"', '"PATCH%NS":["80"');
    expect(broken).not.toBe(text);
    expect(readPatchSource(broken).patches[0]?.complete).toBe(false);
  });

  it('anything else is refused with a readable reason', () => {
    expect(() => readPatchSource('no json')).toThrow(FileFormatError);
    expect(() => readPatchSource('{"format":"other"}')).toThrow(FileFormatError);
  });
});
