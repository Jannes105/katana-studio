import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDR, SIZE, addr } from '../../src/protocol/address';
import { patchName } from '../../src/protocol/encoding';
import { greet } from '../../src/protocol/greeting';
import { SendQueue } from '../../src/protocol/queue';
import { buildDt1, hex, parseHex, parseMessage } from '../../src/protocol/sysex';
import {
  BOM,
  CaptureRecorder,
  captureToJson,
  parseCapture,
  sanitizeCapture,
  type Capture,
} from '../../src/mock/capture';
import { MockAmp } from '../../src/mock/mock-amp';
import { ReplayTransport } from '../../src/mock/replay';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function run<T>(promise: Promise<T>, ms = 3000): Promise<T> {
  let settled = false;
  const p = promise.finally(() => (settled = true));
  for (let i = 0; i < ms && !settled; i += 10) await vi.advanceTimersByTimeAsync(10);
  return p;
}

describe('capture recorder', () => {
  it('records both directions with times and markers, in the probe format', async () => {
    const amp = new MockAmp();
    const recorder = new CaptureRecorder(amp, { now: () => Date.now(), appVersion: '0.1.0' });
    const queue = new SendQueue(recorder);
    recorder.marker('connect');
    await run(greet(queue));
    const capture = recorder.snapshot('note');
    expect(capture).toMatchObject({
      formatVersion: 1,
      tool: 'katana-studio',
      appVersion: '0.1.0',
      notes: 'note',
    });
    expect(capture.events[0]).toEqual({ t: 0, dir: 'marker', text: 'connect' });
    const dirs = capture.events.map((e) => e.dir);
    expect(dirs).toEqual(['marker', 'out', 'in', 'out', 'in', 'out', 'out', 'in']);
    const times = capture.events.map((e) => e.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(capture.events[1]).toEqual({ t: 0, dir: 'out', bytes: 'F0 7E 7F 06 01 F7' });
  });

  it('records each incoming message once, however many listeners there are', async () => {
    const amp = new MockAmp();
    const recorder = new CaptureRecorder(amp);
    const a: unknown[] = [];
    const b: unknown[] = [];
    recorder.onMessage((m) => a.push(m));
    recorder.onMessage((m) => b.push(m));
    await recorder.send([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);
    await vi.advanceTimersByTimeAsync(10);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(recorder.snapshot().events.filter((e) => e.dir === 'in')).toHaveLength(1);
  });

  it('drops the oldest events beyond the limit and says so', async () => {
    const recorder = new CaptureRecorder(new MockAmp(), { maxEvents: 3 });
    for (let i = 0; i < 5; i++) recorder.marker(`m${i}`);
    const capture = recorder.snapshot();
    expect(capture.events.map((e) => (e.dir === 'marker' ? e.text : ''))).toEqual(['m2', 'm3', 'm4']);
    expect(capture.droppedEvents).toBe(2);
    recorder.clear();
    expect(recorder.size).toBe(0);
  });

  it('round-trips through JSON and reads probe files with a BOM', () => {
    const capture: Capture = {
      formatVersion: 1,
      tool: 'katana-probe.ps1',
      startedAt: '2026-11-15T18:15:35.8845637+01:00',
      events: [
        { t: 97.37, dir: 'marker', text: 'identity request' },
        { t: 104.6, dir: 'out', bytes: 'F0 7E 7F 06 01 F7' },
      ],
    };
    expect(parseCapture(BOM + captureToJson(capture))).toEqual(capture);
    expect(() => parseCapture('{"formatVersion":2,"events":[]}')).toThrow(SyntaxError);
    expect(() => parseCapture('{"formatVersion":1,"events":[{"t":1,"dir":"in","bytes":"ZZ"}]}')).toThrow();
    expect(() => parseCapture('{"formatVersion":1,"events":[{"t":1,"dir":"sideways"}]}')).toThrow(
      SyntaxError,
    );
  });
});

describe('sanitizeCapture', () => {
  it('replaces patch names with neutral ones and keeps checksums valid', () => {
    const name = (base: number, text: string) => hex(buildDt1(0x10, base, patchName.encode(text)));
    const capture: Capture = {
      formatVersion: 1,
      tool: 'test',
      startedAt: '',
      notes: 'my rehearsal room',
      events: [
        { t: 1, dir: 'in', bytes: name(ADDR.currentPatch, 'My Secret Tone') },
        { t: 2, dir: 'in', bytes: name(addr(0x20, 0x20, 0x00, 0x00), 'Other Tone') },
        { t: 3, dir: 'in', bytes: name(addr(0x20, 0x30, 0x00, 0x00), 'My Secret Tone') },
        { t: 4, dir: 'in', bytes: hex(buildDt1(0x10, addr(0x20, 0x00, 0x58, 0x01), [40])) },
      ],
    };
    const clean = sanitizeCapture(capture);
    expect(clean.notes).toBeUndefined();
    const names = clean.events.slice(0, 3).map((e) => {
      const m = parseMessage(parseHex(e.dir === 'marker' ? '' : e.bytes));
      expect(m.type === 'dt1' && m.checksumOk).toBe(true);
      return m.type === 'dt1' ? patchName.decode([...m.data]) : '';
    });
    expect(names).toEqual(['PATCH 1', 'PATCH 2', 'PATCH 1']);
    expect(clean.events[3]).toEqual(capture.events[3]);
  });

  it('also handles a name inside a whole-patch reply block', () => {
    const data = [...patchName.encode('Private'), 1, 2];
    const capture: Capture = {
      formatVersion: 1,
      tool: 'test',
      startedAt: '',
      events: [{ t: 1, dir: 'in', bytes: hex(buildDt1(0x10, ADDR.currentPatch, data.slice(0, 16))) }],
    };
    const e = sanitizeCapture(capture).events[0];
    expect(e && e.dir !== 'marker' && e.bytes.includes(hex(patchName.encode('PATCH 1')))).toBe(true);
  });
});

describe('replay', () => {
  /** Records a session against the mock, then replays it without the mock. */
  async function recordSession(): Promise<Capture> {
    const recorder = new CaptureRecorder(new MockAmp(), { now: () => Date.now() });
    const queue = new SendQueue(recorder);
    await run(greet(queue));
    await run(queue.read(ADDR.currentPatch, SIZE.patch));
    return parseCapture(captureToJson(recorder.snapshot()));
  }

  it('scripted: the same requests get the recorded replies', async () => {
    const capture = await recordSession();
    const replay = new ReplayTransport(capture);
    const queue = new SendQueue(replay);
    const g = await run(greet(queue));
    expect(g.warnings).toEqual([]);
    const patch = await run(queue.read(ADDR.currentPatch, SIZE.patch));
    expect(patch.blocks.size).toBe(80);
    expect(replay.mismatches).toEqual([]);
    expect(replay.finished).toBe(true);
  });

  it('collects mismatches when the app sends something else', async () => {
    const capture = await recordSession();
    const replay = new ReplayTransport(capture);
    await replay.send([0xf0, 0x01, 0xf7]);
    expect(replay.mismatches).toEqual([{ expected: 'F0 7E 7F 06 01 F7', got: 'F0 01 F7' }]);
  });

  it('can ignore the device ID when matching', async () => {
    const capture: Capture = {
      formatVersion: 1,
      tool: 'test',
      startedAt: '',
      events: [
        { t: 0, dir: 'out', bytes: 'F0 41 10 01 05 07 11 7F 00 00 00 00 00 00 01 00 F7' },
        { t: 4, dir: 'in', bytes: hex(buildDt1(0x10, ADDR.editorLevel, [1])) },
      ],
    };
    const replay = new ReplayTransport(capture, { ignoreDeviceId: true });
    const seen: unknown[] = [];
    replay.onMessage((m) => seen.push(m));
    await replay.send(parseHex('F0 41 11 01 05 07 11 7F 00 00 00 00 00 00 01 00 F7'));
    await vi.advanceTimersByTimeAsync(5);
    expect(replay.mismatches).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it('playAll plays every incoming event with its timing', async () => {
    const capture: Capture = {
      formatVersion: 1,
      tool: 'test',
      startedAt: '',
      events: [
        { t: 100, dir: 'in', bytes: 'F0 41 10 01 05 07 12 00 00 00 00 00 03 7D F7' },
        { t: 150, dir: 'marker', text: 'x' },
        { t: 200, dir: 'in', bytes: 'F0 41 10 01 05 07 12 00 00 00 00 00 04 7C F7' },
      ],
    };
    const replay = new ReplayTransport(capture);
    const seen: number[] = [];
    replay.onMessage(() => seen.push(Date.now()));
    const t0 = Date.now();
    replay.playAll();
    await vi.advanceTimersByTimeAsync(99);
    expect(seen).toEqual([t0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([t0, t0 + 100]);
  });
});
