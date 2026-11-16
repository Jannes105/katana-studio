import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDR, addr, storedPatchAddress } from '../../src/protocol/address';
import { PATCH_BLOCKS, PATCH_RANGE_SIZE } from '../../src/protocol/blocks';
import { SendQueue } from '../../src/protocol/queue';
import { MockAmp } from '../../src/mock/mock-amp';
import { DEMO_PATCHES } from '../../src/mock/demo-patches';
import { AMP_GAIN, AMP_TYPE, EFFECTS, NS_THRESHOLD } from '../../src/model/params';
import { PatchImage, formatValue, patchView, readRaw } from '../../src/model/patch';

function blank(): Map<number, number[]> {
  return new Map(PATCH_BLOCKS.map((b) => [b.offset, new Array<number>(b.length).fill(0)]));
}

describe('PatchImage', () => {
  it('reads within a block and nothing across a block boundary', () => {
    const blocks = blank();
    blocks.set(addr(0, 0, 0x06, 0), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const image = PatchImage.of(blocks);
    expect(image.complete).toBe(true);
    expect(image.read(addr(0, 0, 0x06, 2), 3)).toEqual([3, 4, 5]);
    expect(image.read(addr(0, 0, 0x06, 8), 4)).toBeUndefined();
    expect(image.read(addr(0, 0, 0x07, 0), 1)).toBeUndefined(); // gap between blocks
  });

  it('missing blocks read as undefined', () => {
    const image = PatchImage.of(new Map([[addr(0, 0, 0x58, 0), [1, 40, 30]]]));
    expect(image.complete).toBe(false);
    expect(readRaw(image, NS_THRESHOLD)).toBe(40);
    expect(readRaw(image, AMP_GAIN)).toBeUndefined();
  });

  it('fromReply keeps known blocks with the right length only', () => {
    const base = storedPatchAddress(3);
    const image = PatchImage.fromReply(
      new Map([
        [base + addr(0, 0, 0x58, 0), [1, 40, 30]],
        [base + addr(0, 0, 0x06, 0), [1, 2]], // wrong length
        [base + addr(0, 0, 0x07, 0), [1]], // no block
      ]),
      base,
    );
    expect(image.entries()).toEqual([[addr(0, 0, 0x58, 0), [1, 40, 30]]]);
  });

  it('with() applies reports and is immutable; diff() lists changed bytes', () => {
    const before = PatchImage.of(blank());
    const after = before.with(addr(0, 0, 0x58, 0x01), [55]).with(addr(0, 0, 0x06, 0x09), [1, 2, 3]);
    expect(readRaw(before, NS_THRESHOLD)).toBe(0);
    expect(readRaw(after, NS_THRESHOLD)).toBe(55);
    expect(after.diff(before)).toEqual([addr(0, 0, 0x06, 0x09), addr(0, 0, 0x58, 0x01)]); // block end clips
    expect(PatchImage.EMPTY.with(0, [1])).toBe(PatchImage.EMPTY); // block not read yet
  });
});

describe('formatValue', () => {
  it('uses the table, or a fallback with the label', () => {
    expect(formatValue(AMP_TYPE, 3)).toBe('Crunch');
    expect(formatValue(AMP_TYPE, 9)).toBe('Type 9');
    expect(formatValue(NS_THRESHOLD, 40)).toBe('40');
    expect(formatValue({ ...NS_THRESHOLD, display: { rawOffset: 50, unit: 'dB' } }, 44)).toBe('-6 dB');
  });
});

describe('patchView against the demo mock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('decodes a full range read of the current patch', async () => {
    const amp = new MockAmp({ content: 'demo' });
    const queue = new SendQueue(amp);
    const run = async <T>(p: Promise<T>): Promise<T> => {
      await vi.advanceTimersByTimeAsync(1000);
      return p;
    };
    await run(queue.identify());
    const reply = await run(queue.read(ADDR.currentPatch, PATCH_RANGE_SIZE));
    const view = patchView(PatchImage.fromReply(reply.blocks, ADDR.currentPatch));

    const demo = DEMO_PATCHES[amp.patchNumber];
    if (!demo) throw new Error('no demo patch');
    expect(view.name).toBe(demo.name);
    expect(view.values.get('amp.gain')).toBe(demo.knobs[0]);
    expect(view.values.get('amp.type')).toBe(demo.ampType);
    expect(view.values.get('amp.variation')).toBe(demo.variation);
    expect(view.values.get('ns.threshold')).toBe(demo.ns[1]);
    expect(view.effects.map((e) => e.key)).toEqual(EFFECTS.map((g) => g.key));
    view.effects.forEach((e, k) => {
      expect(e.on).toBe(demo.on[k] === 1);
      expect(e.colour).toBe(demo.colours[k]);
      expect(e.types).toHaveLength(3);
      for (const n of e.typeNames) expect(n).not.toMatch(/^Type /); // names from our tables
    });
  });
});
