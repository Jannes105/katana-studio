import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Recorder } from './recorder.js';

function makeRecorder() {
  let clock = 1000;
  const recorder = new Recorder({ now: () => clock, wallClock: () => new Date('2026-11-15T10:00:00Z') });
  return { recorder, advance: (ms) => { clock += ms; } };
}

test('records messages with relative timestamps and hex bytes', () => {
  const { recorder, advance } = makeRecorder();
  advance(12.3456);
  const out = recorder.addMessage('out', [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);
  advance(4);
  const incoming = recorder.addMessage('in', Uint8Array.from([0xf0, 0x41, 0xf7]), { reply: false });
  assert.deepEqual(out, { t: 12.346, dir: 'out', bytes: 'F0 7E 7F 06 01 F7' });
  assert.deepEqual(incoming, { t: 16.346, dir: 'in', bytes: 'F0 41 F7', reply: false });
  assert.equal(recorder.startedAt.toISOString(), '2026-11-15T10:00:00.000Z');
  assert.deepEqual(recorder.counts(), { in: 1, out: 1, marker: 0 });
});

test('explicit timestamps from the MIDI event are converted to session time', () => {
  const { recorder } = makeRecorder();
  const event = recorder.addMessage('in', [0xf0, 0xf7], { t: recorder.toSessionTime(1250.5) });
  assert.equal(event.t, 250.5);
});

test('active sensing and clock are counted, not recorded', () => {
  const { recorder } = makeRecorder();
  assert.equal(recorder.addMessage('in', [0xfe]), null);
  assert.equal(recorder.addMessage('in', [0xfe]), null);
  assert.equal(recorder.addMessage('in', [0xf8]), null);
  assert.equal(recorder.events.length, 0);
  assert.deepEqual(recorder.filtered, { activeSensing: 2, clock: 1 });
});

test('markers are part of the recording; empty markers are ignored', () => {
  const { recorder, advance } = makeRecorder();
  const seen = [];
  recorder.onEvent = (e) => seen.push(e);
  advance(5);
  assert.deepEqual(recorder.addMarker('  pressed A2  '), { t: 5, dir: 'marker', text: 'pressed A2' });
  assert.equal(recorder.addMarker('   '), null);
  assert.equal(seen.length, 1);
  assert.deepEqual(recorder.counts(), { in: 0, out: 0, marker: 1 });
});

test('reset starts a new session', () => {
  const { recorder, advance } = makeRecorder();
  recorder.addMessage('in', [0xfe]);
  recorder.addMarker('x');
  advance(100);
  recorder.reset();
  assert.equal(recorder.events.length, 0);
  assert.equal(recorder.now(), 0);
  assert.deepEqual(recorder.filtered, { activeSensing: 0, clock: 0 });
  assert.throws(() => recorder.addMessage('sideways', [0x90]));
});
