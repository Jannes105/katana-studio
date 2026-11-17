// Checks shared by the local test against all captures (tests/local/, owner's PC only) and the CI test against the
// sanitized excerpts in tests/fixtures/ (PLAN 4.7).

import { expect, vi } from 'vitest';
import { formatAddress } from '../../src/protocol/address';
import { expectedBlockAddresses } from '../../src/protocol/blocks';
import { SendQueue } from '../../src/protocol/queue';
import { parseHex, parseMessage, type ParsedMessage } from '../../src/protocol/sysex';
import type { Capture, CaptureEvent } from '../../src/mock/capture';
import { ReplayTransport } from '../../src/mock/replay';

export const IDENTITY: CaptureEvent[] = [
  { t: 0, dir: 'out', bytes: 'F0 7E 7F 06 01 F7' },
  { t: 1, dir: 'in', bytes: 'F0 7E 10 06 02 41 07 05 00 00 06 00 00 00 F7' },
];

/** Every incoming message, parsed. */
export function incoming(capture: Capture): ParsedMessage[] {
  return capture.events.flatMap((e) => (e.dir === 'in' ? [parseMessage(parseHex(e.bytes))] : []));
}

/**
 * Every range RQ1 of a capture, with the events up to the next request (RQ1 or identity). DT1 sent in between
 * do not end the slice: in the write tests the probe kept writing while the reply was still arriving.
 * Requests sent in a burst (protocol-notes 2.13: five full-patch RQ1 back to back) have no reply of their own
 * before the next one; only the last of such a group is kept, its slice holds all replies.
 */
export function rangeRequests(capture: Capture) {
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
    out.push({ at: i, address: m.address, size: m.size, events });
  });
  return out;
}

/** Every incoming message parses; Roland messages carry a valid checksum. */
export function expectValidMessages(capture: Capture): void {
  for (const e of capture.events) {
    if (e.dir !== 'in') continue;
    const m = parseMessage(parseHex(e.bytes));
    if (m.type === 'dt1' || m.type === 'rq1') expect(m.checksumOk, e.bytes).toBe(true);
    else expect(['identity', 'dt1'], e.bytes).toContain(m.type);
  }
}

/** Each range request is answered with exactly the blocks of the block table. */
export function expectCompleteRangeReplies(capture: Capture, label: string): void {
  for (const r of rangeRequests(capture)) {
    const got = new Set<number>();
    for (const e of r.events) {
      if (e.dir !== 'in') continue;
      const m = parseMessage(parseHex(e.bytes));
      if (m.type === 'dt1' && m.address >= r.address && m.address < r.address + r.size) got.add(m.address);
    }
    const missing = expectedBlockAddresses(r.address, r.size).filter((a) => !got.has(a));
    expect(missing.map(formatAddress), `RQ1 ${formatAddress(r.address)} in ${label}`).toEqual([]);
  }
}

/** The send queue completes each recorded range request when the capture is replayed. Needs fake timers. */
export async function expectQueueCompletes(capture: Capture): Promise<void> {
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
}

/**
 * A capture in captures/ (any .json there), but not the results file of `katana-probe.ps1 -ParamTest`
 * (param-test-*.json), which lies next to the captures and is no capture.
 */
export function isCaptureFile(name: string): boolean {
  return name.endsWith('.json') && !/^(param|block|save|name)-test-/.test(name);
}
