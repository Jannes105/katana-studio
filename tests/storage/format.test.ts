import { describe, expect, it } from 'vitest';
import { PATCH_BLOCKS, SYSTEM_BLOCKS } from '../../src/protocol/blocks';
import { patchName } from '../../src/protocol/encoding';
import {
  BACKUP_SLOT_INDEXES,
  FileFormatError,
  parseFile,
  sameBytes,
  toJson,
  type BackupFile,
  type PatchEntry,
} from '../../src/storage/format';

function patch(name: string, fill: number): PatchEntry {
  const blocks = new Map(PATCH_BLOCKS.map((b) => [b.key, new Array<number>(b.length).fill(fill)]));
  blocks.set('000000', patchName.encode(name));
  return { channel: 'A1', name, blocks };
}

const meta = {
  createdAt: '2026-11-16T17:00:00.000Z',
  appVersion: '0.1.0',
  model: { code: 6, name: 'KATANA-100' },
  firmware: null,
  memo: '',
};

function backup(fill = 1): BackupFile {
  return {
    kind: 'backup',
    ...meta,
    system: new Map(SYSTEM_BLOCKS.map((b) => [b.key, new Array<number>(b.length).fill(fill)])),
    slots: new Map(BACKUP_SLOT_INDEXES.map((i) => [i, patch(`P${i}`, fill)])),
    current: patch('NOW', fill),
  };
}

describe('file format (PLAN 4.6)', () => {
  it('round-trips a backup byte for byte', () => {
    const b = backup();
    const text = toJson(b);
    const back = parseFile(text);
    expect(back.kind).toBe('backup');
    expect(sameBytes(b, back)).toBe(true);
    expect(toJson(back)).toBe(text);
  });

  it('writes hex per block key, the header first, and no PREVIEW slot', () => {
    const json = JSON.parse(toJson(backup())) as Record<string, unknown>;
    expect(Object.keys(json).slice(0, 4)).toEqual(['format', 'kind', 'formatVersion', 'createdAt']);
    expect(json.format).toBe('katana-studio');
    const slots = json.slots as Record<string, { blocks: Record<string, string> }>;
    expect(Object.keys(slots)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
    expect(slots['1']?.blocks['000600']).toBe('01'.repeat(10));
    expect(Object.keys(slots['1']?.blocks ?? {})).toHaveLength(80);
  });

  it('round-trips a single patch file', () => {
    const f = { kind: 'patch' as const, ...meta, current: patch('SOLO', 3) };
    const back = parseFile(toJson(f));
    expect(back.kind).toBe('patch');
    expect(back.current.name).toBe('SOLO');
    expect(sameBytes(f, back)).toBe(true);
  });

  it('sameBytes ignores time and app version, not the bytes', () => {
    expect(sameBytes(backup(), { ...backup(), createdAt: 'later', appVersion: '9.9.9' })).toBe(true);
    expect(sameBytes(backup(1), backup(2))).toBe(false);
  });

  it('rejects broken files with a reason', () => {
    const good = JSON.parse(toJson(backup())) as Record<string, unknown>;
    const bad = (change: (o: Record<string, unknown>) => void): string => {
      const o = structuredClone(good);
      change(o);
      return JSON.stringify(o);
    };
    expect(() => parseFile('nope')).toThrow(FileFormatError);
    expect(() => parseFile(bad((o) => (o.format = 'x')))).toThrow('format id');
    expect(() => parseFile(bad((o) => (o.formatVersion = 2)))).toThrow('version 2');
    expect(() =>
      parseFile(bad((o) => ((o.current as { blocks: Record<string, string> }).blocks['000600'] = '0101'))),
    ).toThrow('expected 10');
    expect(() =>
      parseFile(bad((o) => ((o.current as { blocks: Record<string, string> }).blocks['000700'] = '01'))),
    ).toThrow('unknown block');
    expect(() =>
      parseFile(
        bad((o) => ((o.current as { blocks: Record<string, string> }).blocks['000600'] = '80'.repeat(10))),
      ),
    ).toThrow('above 7F');
    expect(() => parseFile(bad((o) => ((o.slots as Record<string, unknown>)['9'] = {})))).toThrow(
      'slot 9 is not allowed',
    );
  });
});
