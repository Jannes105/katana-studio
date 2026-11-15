// Session recorder: every MIDI message in both directions plus user markers, with timestamps.
// No DOM access; clocks are injected so the logic can be tested with node --test.

import { hex } from '../shared/katana.js';

const ACTIVE_SENSING = 0xfe;
const TIMING_CLOCK = 0xf8;

export class Recorder {
  // now(): high-resolution milliseconds (performance.now). wallClock(): Date of "now".
  constructor({ now = () => performance.now(), wallClock = () => new Date() } = {}) {
    this.clockNow = now;
    this.wallClock = wallClock;
    this.onEvent = null; // called with every recorded event
    this.reset();
  }

  reset() {
    this.origin = this.clockNow();
    this.startedAt = this.wallClock();
    this.events = [];
    this.filtered = { activeSensing: 0, clock: 0 };
  }

  // Milliseconds since session start.
  now() {
    return this.toSessionTime(this.clockNow());
  }

  // Converts a timestamp of the injected clock (e.g. a MIDI event timeStamp) to session time.
  toSessionTime(clockTime) {
    return Math.round((clockTime - this.origin) * 1000) / 1000;
  }

  // dir: 'in' | 'out'. options.t: session time (defaults to now).
  // options.reply: for incoming DT1, true = answers the outstanding RQ1, false = unsolicited.
  // Returns the event, or null if the message was only counted (active sensing, clock).
  addMessage(dir, bytes, { t, reply } = {}) {
    if (dir !== 'in' && dir !== 'out') throw new Error(`Bad direction: ${dir}`);
    const data = Array.from(bytes);
    if (data.length === 1 && data[0] === ACTIVE_SENSING) {
      this.filtered.activeSensing++;
      return null;
    }
    if (data.length === 1 && data[0] === TIMING_CLOCK) {
      this.filtered.clock++;
      return null;
    }
    const event = { t: t ?? this.now(), dir, bytes: hex(data) };
    if (typeof reply === 'boolean') event.reply = reply;
    return this.push(event);
  }

  addMarker(text, { t } = {}) {
    const clean = String(text).trim();
    if (!clean) return null;
    return this.push({ t: t ?? this.now(), dir: 'marker', text: clean });
  }

  push(event) {
    this.events.push(event);
    if (this.onEvent) this.onEvent(event);
    return event;
  }

  counts() {
    const c = { in: 0, out: 0, marker: 0 };
    for (const e of this.events) c[e.dir]++;
    return c;
  }
}
