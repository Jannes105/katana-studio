import { describe, expect, it } from 'vitest';
import { ADDR, SIZE, addr, formatAddress, storedPatchAddress } from '../../src/protocol/address';
import {
  PATCH_BLOCKS,
  SYSTEM_BLOCKS,
  blockAt,
  expectedBlockAddresses,
  totalLength,
} from '../../src/protocol/blocks';

describe('block tables (protocol-notes 2.12)', () => {
  it('a patch has 80 blocks with 2649 data bytes', () => {
    expect(PATCH_BLOCKS).toHaveLength(80);
    expect(totalLength(PATCH_BLOCKS)).toBe(2649);
  });

  it('patch blocks start every 02 00, the last at 01 1E 00', () => {
    PATCH_BLOCKS.forEach((b, i) => expect(b.offset).toBe(i * addr(0, 0, 0x02, 0)));
    expect(formatAddress(PATCH_BLOCKS.at(-1)?.offset ?? -1)).toBe('00 01 1E 00');
  });

  it('known blocks have the measured lengths', () => {
    const len = (b1: number, b2: number) => PATCH_BLOCKS.find((b) => b.offset === addr(0, b1, b2, 0))?.length;
    expect(len(0x00, 0x00)).toBe(16); // name
    expect(len(0x00, 0x06)).toBe(10); // amp
    expect(len(0x00, 0x08)).toBe(6); // switches
    expect(len(0x00, 0x1c)).toBe(225);
    expect(len(0x00, 0x26)).toBe(225);
    expect(len(0x00, 0x58)).toBe(3); // NS
    expect(len(0x00, 0x7e)).toBe(1);
    expect(len(0x01, 0x00)).toBe(34);
    expect(len(0x01, 0x1c)).toBe(5); // effect knob positions
  });

  it('no block is longer than the gap to the next one', () => {
    for (const blocks of [PATCH_BLOCKS, SYSTEM_BLOCKS]) {
      for (const b of blocks) expect(b.length).toBeLessThanOrEqual(addr(0, 0, 0x02, 0));
    }
  });

  it('SYSTEM has 21 blocks with 131 data bytes', () => {
    expect(SYSTEM_BLOCKS).toHaveLength(21);
    expect(totalLength(SYSTEM_BLOCKS)).toBe(131);
    expect(formatAddress(ADDR.system + (SYSTEM_BLOCKS.at(-1)?.offset ?? -1))).toBe('10 00 28 00');
  });
});

describe('expected block addresses of a range request', () => {
  it('whole current patch: 80 addresses', () => {
    const list = expectedBlockAddresses(ADDR.currentPatch, SIZE.patch);
    expect(list).toHaveLength(80);
    expect(list[0]).toBe(ADDR.currentPatch);
  });

  it('all ten stored slots: 800 addresses, PREVIEW included', () => {
    expect(expectedBlockAddresses(ADDR.storedPatchBase, addr(0x01, 0x20, 0x00, 0x00))).toHaveLength(800);
    // Nine slots stop before PREVIEW (PLAN 4.6).
    const nine = expectedBlockAddresses(ADDR.storedPatchBase, addr(0x01, 0x10, 0x00, 0x00));
    expect(nine).toHaveLength(720);
    expect(nine.every((a) => a < storedPatchAddress(9))).toBe(true);
  });

  it('SYSTEM: 21 addresses', () => {
    expect(expectedBlockAddresses(ADDR.system, SIZE.system)).toHaveLength(21);
    expect(expectedBlockAddresses(ADDR.system, addr(0x00, 0x01, 0x00, 0x00))).toHaveLength(21);
  });

  it('a small read inside one block expects only that block if it starts there', () => {
    expect(expectedBlockAddresses(addr(0x20, 0x00, 0x00, 0x00), 16)).toEqual([ADDR.currentPatch]);
    expect(expectedBlockAddresses(addr(0x20, 0x00, 0x58, 0x01), 1)).toEqual([]);
    expect(expectedBlockAddresses(ADDR.editorLevel, 1)).toEqual([]);
  });

  it('blockAt finds a block by its start address', () => {
    expect(blockAt(addr(0x20, 0x00, 0x58, 0x00))?.block.length).toBe(3);
    expect(blockAt(addr(0x21, 0x10, 0x06, 0x00))?.area.name).toBe('stored patch 8');
    expect(blockAt(addr(0x20, 0x00, 0x58, 0x01))).toBeUndefined();
  });
});
