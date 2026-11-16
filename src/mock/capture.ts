// Capture mode (PLAN 4.7): records every message of a real session with timestamp and direction and exports it
// as a file. Diagnostic tool for problems in rehearsal and for open protocol questions.
//
// The file format is the one of tools/katana-probe.ps1, so captures from the probe, the capture page and the app
// can all be replayed the same way (replay.ts):
//   { formatVersion: 1, tool, startedAt, events: [{ t, dir: 'in' | 'out', bytes: 'F0 …' } | { t, dir: 'marker', text }] }
// `t` is milliseconds since the start of the capture.

import type { MessageListener, MidiMessage, Transport } from '../midi/transport';
import { PATCH_BLOCKS, KNOWN_AREAS } from '../protocol/blocks';
import { PATCH_NAME_LENGTH, patchName } from '../protocol/encoding';
import { buildDt1, hex, parseHex, parseMessage } from '../protocol/sysex';

export type CaptureEvent =
  | { readonly t: number; readonly dir: 'in' | 'out'; readonly bytes: string }
  | { readonly t: number; readonly dir: 'marker'; readonly text: string };

export interface Capture {
  readonly formatVersion: 1;
  readonly tool: string;
  readonly startedAt: string;
  readonly appVersion?: string;
  readonly notes?: string;
  /** Number of oldest events dropped because the capture hit its size limit. */
  readonly droppedEvents?: number;
  readonly events: readonly CaptureEvent[];
}

export interface CaptureOptions {
  /** Milliseconds, monotonic. */
  readonly now?: () => number;
  readonly tool?: string;
  readonly appVersion?: string;
  /** Oldest events are dropped beyond this (a two-hour rehearsal with knob reports can reach 100 000+). */
  readonly maxEvents?: number;
}

export const DEFAULT_MAX_EVENTS = 200_000;

/** Wraps a transport and records everything that passes through it. */
export class CaptureRecorder implements Transport {
  private readonly listeners = new Set<MessageListener>();
  private readonly now: () => number;
  private readonly tool: string;
  private readonly appVersion: string | undefined;
  private readonly maxEvents: number;
  private events: CaptureEvent[] = [];
  private dropped = 0;
  private startedAt = new Date();
  private t0: number;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly inner: Transport,
    options: CaptureOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.tool = options.tool ?? 'katana-studio';
    this.appVersion = options.appVersion;
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
    this.t0 = this.now();
    // One subscription to the inner transport, however many listeners we have: each message is recorded once.
    this.unsubscribe = inner.onMessage((message) => {
      this.record({ t: this.elapsed(), dir: 'in', bytes: hex([...message]) });
      for (const l of this.listeners) l(message);
    });
  }

  send(message: MidiMessage): Promise<void> {
    this.record({ t: this.elapsed(), dir: 'out', bytes: hex([...message]) });
    return this.inner.send(message);
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Adds a marker ("pressed A2 on the amp", "error: …"). */
  marker(text: string): void {
    this.record({ t: this.elapsed(), dir: 'marker', text });
  }

  /** Starts a fresh capture. */
  clear(): void {
    this.events = [];
    this.dropped = 0;
    this.startedAt = new Date();
    this.t0 = this.now();
  }

  get size(): number {
    return this.events.length;
  }

  snapshot(notes?: string): Capture {
    return {
      formatVersion: 1,
      tool: this.tool,
      startedAt: this.startedAt.toISOString(),
      ...(this.appVersion !== undefined ? { appVersion: this.appVersion } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(this.dropped > 0 ? { droppedEvents: this.dropped } : {}),
      events: [...this.events],
    };
  }

  /** Stops recording and detaches from the inner transport. */
  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  private elapsed(): number {
    return Math.round((this.now() - this.t0) * 100) / 100;
  }

  private record(event: CaptureEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      const excess = this.events.length - this.maxEvents;
      this.events.splice(0, excess);
      this.dropped += excess;
    }
  }
}

/** Byte order mark; katana-probe.ps1 writes its files with one. */
export const BOM = String.fromCharCode(0xfeff);

export function captureToJson(capture: Capture): string {
  return JSON.stringify(capture);
}

/** Parses a capture file (also the ones written by katana-probe.ps1, which start with a BOM). */
export function parseCapture(text: string): Capture {
  const raw: unknown = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text);
  if (typeof raw !== 'object' || raw === null) throw new SyntaxError('Capture: not an object');
  const c = raw as Record<string, unknown>;
  if (c.formatVersion !== 1)
    throw new SyntaxError(`Capture: unsupported formatVersion ${String(c.formatVersion)}`);
  if (!Array.isArray(c.events)) throw new SyntaxError('Capture: events missing');
  const events: CaptureEvent[] = c.events.map((e: unknown, i) => {
    const ev = e as Record<string, unknown>;
    if (typeof ev.t !== 'number') throw new SyntaxError(`Capture: event ${i} has no time`);
    if ((ev.dir === 'in' || ev.dir === 'out') && typeof ev.bytes === 'string') {
      parseHex(ev.bytes); // validates
      return { t: ev.t, dir: ev.dir, bytes: ev.bytes };
    }
    if (ev.dir === 'marker' && typeof ev.text === 'string') return { t: ev.t, dir: 'marker', text: ev.text };
    throw new SyntaxError(`Capture: event ${i} is malformed`);
  });
  return {
    formatVersion: 1,
    tool: typeof c.tool === 'string' ? c.tool : 'unknown',
    startedAt: typeof c.startedAt === 'string' ? c.startedAt : '',
    ...(typeof c.appVersion === 'string' ? { appVersion: c.appVersion } : {}),
    ...(typeof c.notes === 'string' ? { notes: c.notes } : {}),
    ...(typeof c.droppedEvents === 'number' ? { droppedEvents: c.droppedEvents } : {}),
    events,
  };
}

/** Start addresses of every patch name (current patch and the ten stored slots). */
const NAME_ADDRESSES = new Set(
  KNOWN_AREAS.filter((a) => a.blocks === PATCH_BLOCKS).map((a) => a.base + (PATCH_BLOCKS[0]?.offset ?? 0)),
);

/**
 * Prepares a capture for tests/fixtures (PLAN 4.7): replaces every patch name in DT1 messages with a neutral one
 * ("PATCH 1", "PATCH 2", … per distinct name), recomputes the checksum and drops the notes. Patch values stay.
 */
export function sanitizeCapture(capture: Capture): Capture {
  const names = new Map<string, string>();
  const neutral = (name: string): string => {
    let n = names.get(name);
    if (n === undefined) {
      n = `PATCH ${names.size + 1}`;
      names.set(name, n);
    }
    return n;
  };
  const events = capture.events.map((e): CaptureEvent => {
    if (e.dir === 'marker') return e;
    const m = parseMessage(parseHex(e.bytes));
    if (m.type !== 'dt1' || !NAME_ADDRESSES.has(m.address)) return e;
    const length = Math.min(PATCH_NAME_LENGTH, m.data.length);
    const original = String.fromCharCode(...m.data.slice(0, length));
    const replacement = patchName.encode(neutral(original.trimEnd())).slice(0, length);
    const data = [...replacement, ...m.data.slice(length)];
    return { t: e.t, dir: e.dir, bytes: hex(buildDt1(m.deviceId, m.address, data)) };
  });
  const clean: Capture = { ...capture, events };
  delete (clean as { notes?: string }).notes;
  return clean;
}
