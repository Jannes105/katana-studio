/// <reference types="node" />
// CI checks against the sanitized excerpts of real captures in tests/fixtures/ (PLAN 4.7, 9.2 D 20). Same checks as
// tests/local/captures.test.ts, plus what each excerpt is there to show. Regenerate with
// `MAKE_FIXTURES=1 npx vitest run tests/local/make-fixtures` (owner's PC only).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDR, PREVIEW_INDEX, addr, storedPatchAddress } from '../src/protocol/address';
import { u2x4 } from '../src/protocol/encoding';
import type { Dt1Message, ParsedMessage } from '../src/protocol/sysex';
import { parseCapture, type Capture } from '../src/mock/capture';
import { AMP_GAIN, AMP_TYPE_NAMES } from '../src/model/params';
import { PatchImage, patchView } from '../src/model/patch';
import {
  expectCompleteRangeReplies,
  expectQueueCompletes,
  expectValidMessages,
  incoming,
} from './helpers/capture-checks';

const DIR = join(__dirname, 'fixtures');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const load = (name: string): Capture => parseCapture(readFileSync(join(DIR, name), 'utf8'));

const dt1 = (ms: readonly ParsedMessage[]): Dt1Message[] =>
  ms.filter((m): m is Dt1Message => m.type === 'dt1' && m.checksumOk);

/** DT1 data at `address`, in arrival order. */
const at = (capture: Capture, address: number): (readonly number[])[] =>
  dt1(incoming(capture))
    .filter((m) => m.address === address)
    .map((m) => m.data);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('fixtures from real captures', () => {
  it('there are the four excerpts', () => {
    expect(files.sort()).toEqual([
      'channel-change-on-amp.json',
      'full-patch-and-slots.json',
      'knob-stream.json',
      'save-on-amp.json',
    ]);
  });

  it.each(files)('%s: valid messages, complete range replies, the queue completes them', async (file) => {
    const c = load(file);
    expect(c.notes).toBeTruthy();
    expectValidMessages(c);
    expectCompleteRangeReplies(c, file);
    await expectQueueCompletes(c);
  });

  it.each(files)('%s: patch names are neutral', (file) => {
    for (const m of dt1(incoming(load(file)))) {
      const inPatch =
        m.address === ADDR.currentPatch || (m.address - ADDR.storedPatchBase) % addr(0, 0x10, 0, 0) === 0;
      if (!inPatch || m.address < ADDR.currentPatch) continue;
      const name = String.fromCharCode(...m.data.slice(0, 16)).trimEnd();
      expect(name, file).toMatch(/^(PATCH \d+)?$/);
    }
  });
});

describe('full-patch-and-slots', () => {
  const c = load('full-patch-and-slots.json');
  const blocks = new Map(dt1(incoming(c)).map((m) => [m.address, m.data]));

  it('holds all ten stored slots and the current patch, complete', () => {
    for (let i = 0; i <= PREVIEW_INDEX; i++) {
      expect(PatchImage.fromReply(blocks, storedPatchAddress(i)).complete, `slot ${i}`).toBe(true);
    }
    expect(PatchImage.fromReply(blocks, ADDR.currentPatch).complete).toBe(true);
  });

  it('after PATCH_SELECT 1 the current patch equals stored slot 1 (index n in PATCH(n+1))', () => {
    const current = PatchImage.fromReply(blocks, ADDR.currentPatch);
    const slot1 = PatchImage.fromReply(blocks, storedPatchAddress(1));
    expect(current.diff(slot1)).toEqual([]);
    expect(at(c, ADDR.patchNumber).at(-1)).toEqual(u2x4.encode(1));
  });

  it('every patch decodes to plausible values', () => {
    for (let i = 0; i <= PREVIEW_INDEX; i++) {
      const v = patchView(PatchImage.fromReply(blocks, storedPatchAddress(i)));
      expect(v.values.get('amp.type')).toBeLessThan(AMP_TYPE_NAMES.length);
      expect([0, 1]).toContain(v.values.get('amp.variation'));
      for (const e of v.effects) expect([0, 1, 2]).toContain(e.colour);
    }
  });
});

describe('channel-change-on-amp', () => {
  const c = load('channel-change-on-amp.json');

  it('reports each channel change with the patch number, after the status bytes', () => {
    // Only the listening window: the snapshots around it read 00 00 00 00 themselves.
    const marker = (prefix: string) =>
      c.events.findIndex((e) => e.dir === 'marker' && e.text.startsWith(prefix));
    const live: Capture = { ...c, events: c.events.slice(marker('listen start'), marker('listen end')) };
    const msgs = dt1(incoming(live));
    const reports = msgs.filter((m) => m.address === ADDR.patchNumber);
    // Pressed on the amp: A4, A1, B1, B4, PANEL, B3, B2.
    expect(reports.map((m) => u2x4.decode([...m.data]))).toEqual([4, 1, 5, 8, 0, 7, 6]);
    for (const r of reports) {
      const before = msgs[msgs.indexOf(r) - 1];
      expect(before?.address).toBe(ADDR.effectStatus + 3); // the second round ends with status byte 4
    }
  });

  it('sends the status bytes and, for PANEL, the effect knob block 30 00 02 00', () => {
    expect(at(c, ADDR.effectStatus).length).toBeGreaterThan(0);
    expect(at(c, addr(0x30, 0x00, 0x02, 0x00)).length).toBeGreaterThan(0);
  });
});

describe('knob-stream', () => {
  it('reports the amp knobs one value at a time', () => {
    const c = load('knob-stream.json');
    const gain = ADDR.currentPatch + AMP_GAIN.at;
    // Snapshot replies carry the whole amp block at the same address; the reports are single bytes.
    const reports = at(c, gain).filter((d) => d.length === 1);
    expect(reports.length).toBeGreaterThan(5);
    for (const [v] of reports) expect(v).toBeLessThanOrEqual(100);
  });
});

describe('save-on-amp', () => {
  it('reports PATCH_WRITE with the index of B4', () => {
    expect(at(load('save-on-amp.json'), ADDR.patchWrite)).toEqual([u2x4.encode(8)]);
  });
});
