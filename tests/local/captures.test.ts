/// <reference types="node" />
// Checks against the real captures in captures/ (private, git-ignored). Runs only where that folder exists,
// i.e. on the owner's PC, never in CI. Fixtures for CI come later as sanitized excerpts (PLAN 4.7).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatAddress } from '../../src/protocol/address';
import { expectedBlockAddresses } from '../../src/protocol/blocks';
import { SendQueue } from '../../src/protocol/queue';
import { parseHex, parseMessage } from '../../src/protocol/sysex';
import { parseCapture, type Capture, type CaptureEvent } from '../../src/mock/capture';
import { ReplayTransport } from '../../src/mock/replay';

const DIR = join(__dirname, '..', '..', 'captures');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
const IDENTITY: CaptureEvent[] = [
  { t: 0, dir: 'out', bytes: 'F0 7E 7F 06 01 F7' },
  { t: 1, dir: 'in', bytes: 'F0 7E 10 06 02 41 07 05 00 00 06 00 00 00 F7' },
];

/**
 * Every range RQ1 of a capture, with the events up to the next request (RQ1 or identity). DT1 sent in between
 * do not end the slice: in the write tests the probe kept writing while the reply was still arriving.
 * Requests sent in a burst (protocol-notes 2.13: five full-patch RQ1 back to back) have no reply of their own
 * before the next one; only the last of such a group is kept, its slice holds all replies.
 */
function rangeRequests(capture: Capture) {
  const out: { at: number; address: number; size: number; events: CaptureEvent[] }[] = [];
  capture.events.forEach((e, i) => {
    if (e.dir !== 'out') return;
    const m = parseMessage(parseHex(e.bytes));
    if (m.type !== 'rq1' || expectedBlockAddresses(m.address, m.size).length === 0) return;
    const next = capture.events.findIndex(
      (x, j) => j > i && x.dir === 'out' && parseMessage(parseHex(x.bytes)).type !== 'dt1',
    );
    const events = capture.events.slice(i, next < 0 ? undefined : next);
    if (!events.some((x) => x.dir === 'in')) return;
    out.push({
      at: i,
      address: m.address,
      size: m.size,
      events,
    });
  });
  return out;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe.skipIf(files.length === 0)('real captures (local only)', () => {
  it.each(files)('%s: every incoming message parses with a valid checksum', (file) => {
    const capture = parseCapture(readFileSync(join(DIR, file), 'utf8'));
    for (const e of capture.events) {
      if (e.dir !== 'in') continue;
      const m = parseMessage(parseHex(e.bytes));
      if (m.type === 'dt1' || m.type === 'rq1') expect(m.checksumOk, e.bytes).toBe(true);
      else expect(['identity', 'dt1'], e.bytes).toContain(m.type);
    }
  });

  it.each(files)('%s: each range request is answered with exactly the blocks of the block table', (file) => {
    const capture = parseCapture(readFileSync(join(DIR, file), 'utf8'));
    for (const r of rangeRequests(capture)) {
      const got = new Set<number>();
      for (const e of r.events) {
        if (e.dir !== 'in') continue;
        const m = parseMessage(parseHex(e.bytes));
        if (m.type === 'dt1' && m.address >= r.address && m.address < r.address + r.size) got.add(m.address);
      }
      const missing = expectedBlockAddresses(r.address, r.size).filter((a) => !got.has(a));
      expect(missing.map(formatAddress), `RQ1 ${formatAddress(r.address)} in ${file}`).toEqual([]);
    }
  });

  it.each(files)('%s: the queue completes each recorded range request', async (file) => {
    const capture = parseCapture(readFileSync(join(DIR, file), 'utf8'));
    for (const r of rangeRequests(capture)) {
      const first = r.events[0]?.t ?? 0;
      const slice: Capture = {
        ...capture,
        // Only the RQ1 itself is sent by the queue; DT1 the probe sent in between are left out.
        events: [
          ...IDENTITY,
          ...r.events.filter((e, i) => i === 0 || e.dir !== 'out').map((e) => ({ ...e, t: e.t - first + 2 })),
        ],
      };
      const replay = new ReplayTransport(slice, { ignoreDeviceId: true });
      const queue = new SendQueue(replay);
      const id = queue.identify();
      await vi.advanceTimersByTimeAsync(5);
      await id;
      let done = false;
      const read = queue.read(r.address, r.size).then((x) => ((done = true), x));
      for (let t = 0; t < 10_000 && !done; t += 50) await vi.advanceTimersByTimeAsync(50);
      const reply = await read;
      expect(reply.blocks.size).toBeGreaterThanOrEqual(expectedBlockAddresses(r.address, r.size).length);
      expect(replay.mismatches).toEqual([]);
    }
  });
});
