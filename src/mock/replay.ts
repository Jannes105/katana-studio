// Replays a recorded capture as a Transport (PLAN 4.7: tests against real captures, because the mock amp only
// mirrors our own assumptions).
//
// Two ways to use it:
// - scripted: every message the app sends is compared with the next recorded 'out' event; on a match the 'in'
//   events up to the next 'out' are played with their recorded timing. Mismatches are collected.
// - playAll(): plays every 'in' event with its recorded timing, regardless of what is sent (for captures that
//   only listened, e.g. channel changes on the amp).

import type { MessageListener, MidiMessage, Transport } from '../midi/transport';
import { hex, parseHex } from '../protocol/sysex';
import type { Capture, CaptureEvent } from './capture';

export interface ReplayMismatch {
  readonly expected: string | undefined;
  readonly got: string;
}

export interface ReplayOptions {
  /** 2 plays twice as fast. Default 1. */
  readonly speed?: number;
  /**
   * Compares sent messages with the device ID byte (index 2) ignored, so a capture taken with another device ID
   * still matches. Default false.
   */
  readonly ignoreDeviceId?: boolean;
}

type DataEvent = Extract<CaptureEvent, { dir: 'in' | 'out' }>;

export class ReplayTransport implements Transport {
  private readonly listeners = new Set<MessageListener>();
  private readonly events: readonly DataEvent[];
  private readonly speed: number;
  private readonly ignoreDeviceId: boolean;
  /** Index of the next event not yet consumed. */
  private cursor = 0;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  readonly mismatches: ReplayMismatch[] = [];

  constructor(capture: Capture, options: ReplayOptions = {}) {
    this.events = capture.events.filter((e): e is DataEvent => e.dir !== 'marker');
    this.speed = options.speed ?? 1;
    this.ignoreDeviceId = options.ignoreDeviceId ?? false;
  }

  send(message: MidiMessage): Promise<void> {
    const got = hex([...message]);
    const index = this.findNextOut(got);
    if (index === undefined) {
      this.mismatches.push({ expected: this.peekOut(), got });
      return Promise.resolve();
    }
    if (index !== this.nextOutIndex()) this.mismatches.push({ expected: this.peekOut(), got });
    const out = this.events[index];
    this.cursor = index + 1;
    if (out) this.playUntilNextOut(out.t);
    return Promise.resolve();
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Plays every recorded 'in' event with its timing, from the first event on. */
  playAll(): void {
    const first = this.events[0];
    if (!first) return;
    for (const e of this.events) if (e.dir === 'in') this.schedule(e, first.t);
    this.cursor = this.events.length;
  }

  /** True when every recorded event has been consumed. */
  get finished(): boolean {
    return this.cursor >= this.events.length;
  }

  /** Cancels pending playback. */
  stop(): void {
    for (const t of this.timers.splice(0)) clearTimeout(t);
  }

  private playUntilNextOut(fromT: number): void {
    while (this.cursor < this.events.length) {
      const e = this.events[this.cursor];
      if (!e || e.dir === 'out') return;
      this.schedule(e, fromT);
      this.cursor++;
    }
  }

  private schedule(e: DataEvent, fromT: number): void {
    const bytes = parseHex(e.bytes);
    const delay = Math.max(0, (e.t - fromT) / this.speed);
    this.timers.push(
      setTimeout(() => {
        for (const l of this.listeners) l(bytes);
      }, delay),
    );
  }

  private nextOutIndex(): number | undefined {
    for (let i = this.cursor; i < this.events.length; i++) if (this.events[i]?.dir === 'out') return i;
    return undefined;
  }

  private peekOut(): string | undefined {
    const i = this.nextOutIndex();
    return i === undefined ? undefined : this.events[i]?.bytes;
  }

  /** The next recorded 'out' equal to `got`, searching ahead to resynchronise after a mismatch. */
  private findNextOut(got: string): number | undefined {
    for (let i = this.cursor; i < this.events.length; i++) {
      const e = this.events[i];
      if (e?.dir === 'out' && this.same(e.bytes, got)) return i;
    }
    return undefined;
  }

  private same(a: string, b: string): boolean {
    if (!this.ignoreDeviceId) return a === b;
    const x = a.split(' ');
    const y = b.split(' ');
    return x.length === y.length && x.every((v, i) => i === 2 || v === y[i]);
  }
}
