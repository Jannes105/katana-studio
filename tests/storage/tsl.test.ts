import { describe, expect, it } from 'vitest';
import { PATCH_BLOCKS } from '../../src/protocol/blocks';
import { patchName } from '../../src/protocol/encoding';
import { TSL_BLOCK_NAMES, TSL_DEVICE, fromTsl, toTsl } from '../../src/storage/tsl';

function blocks(fill: number, name: string): Map<string, number[]> {
  const m = new Map(PATCH_BLOCKS.map((b) => [b.key, new Array<number>(b.length).fill(fill)]));
  m.set('000000', patchName.encode(name));
  return m;
}

describe('.tsl export (PLAN 4.6)', () => {
  it('names all 80 blocks, one to one, in block order', () => {
    expect(TSL_BLOCK_NAMES.size).toBe(80);
    expect(new Set(TSL_BLOCK_NAMES.values()).size).toBe(80);
    expect(TSL_BLOCK_NAMES.get('000000')).toBe('PATCH%COM');
    expect(TSL_BLOCK_NAMES.get('000600')).toBe('PATCH%AMP');
    expect(TSL_BLOCK_NAMES.get('005800')).toBe('PATCH%NS');
    expect(TSL_BLOCK_NAMES.get('004000')).toBe('PATCH%CONTOUR_COM');
    expect(TSL_BLOCK_NAMES.get('011E00')).toBe('PATCH%PATCH_KNOB_SOLO_DELAY_READONLY');
  });

  it('writes the live set layout with two-digit hex strings', () => {
    const o = JSON.parse(toTsl('Set', [{ blocks: blocks(10, 'ONE') }])) as {
      name: string;
      formatRev: string;
      device: string;
      data: { memo: { memo: string; isToneCentralPatch: boolean }; paramSet: Record<string, string[]> }[][];
    };
    expect(o).toMatchObject({ name: 'Set', formatRev: '0000', device: TSL_DEVICE });
    expect(o.data).toHaveLength(1);
    const p = o.data[0]?.[0];
    expect(p?.memo).toEqual({ memo: '', isToneCentralPatch: false });
    expect(Object.keys(p?.paramSet ?? {})).toHaveLength(80);
    expect(p?.paramSet['PATCH%AMP']).toEqual(new Array(10).fill('0A'));
    expect(p?.paramSet['PATCH%COM']?.slice(0, 3)).toEqual(['4F', '4E', '45']); // "ONE"
  });

  it('round-trips several patches in order', () => {
    const text = toTsl('Set', [{ memo: 'A1 x', blocks: blocks(1, 'X') }, { blocks: blocks(2, 'Y') }]);
    const back = fromTsl(text);
    expect(back.name).toBe('Set');
    expect(back.patches.map((p) => p.memo)).toEqual(['A1 x', '']);
    expect(back.patches[1]?.blocks.get('000600')).toEqual(new Array(10).fill(2));
    expect(back.patches[0]?.blocks.size).toBe(80);
  });

  it('refuses a patch with a missing block and files of another device', () => {
    const partial = blocks(1, 'X');
    partial.delete('005800');
    expect(() => toTsl('Set', [{ blocks: partial }])).toThrow('005800');
    expect(() => fromTsl(JSON.stringify({ device: 'KATANA MkII', data: [[]] }))).toThrow('KATANA Gen3');
  });
});
