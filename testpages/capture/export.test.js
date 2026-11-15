import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADDR, IDENTITY_REQUEST, buildDt1, buildRq1, hex } from '../shared/katana.js';
import { Recorder } from './recorder.js';
import { FORMAT_VERSION, buildExport, exportFileName, sessionToText } from './export.js';
import { describeAddress, describeBytes } from './describe.js';
import { EXPERIMENTS } from './experiments.js';

const IDENTITY_REPLY = [0xf0, 0x7e, 0x10, 0x06, 0x02, 0x41, 0x07, 0x05, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0xf7];

function sampleSession() {
  let clock = 0;
  const recorder = new Recorder({ now: () => clock, wallClock: () => new Date('2026-11-15T10:00:00Z') });
  recorder.addMessage('out', IDENTITY_REQUEST);
  clock = 4.5;
  recorder.addMessage('in', IDENTITY_REPLY);
  recorder.addMessage('in', [0xfe]);
  clock = 2000;
  recorder.addMarker('pressed channel A2 on the amp now');
  clock = 2100.25;
  recorder.addMessage('in', buildDt1(0x10, ADDR.patchNumber, [0x00, 0x02]), { reply: false });
  return {
    startedAt: recorder.startedAt,
    events: recorder.events,
    filtered: recorder.filtered,
    portName: 'KATANA3',
    identity: hex(IDENTITY_REPLY),
    deviceId: 0x10,
    modelCode: 0x06,
    settings: { silenceGapMs: 300 },
    experiments: [{ id: 'Q1', title: 'Patch change', notes: 'line one\nline two', extra: 'dropped' }],
  };
}

test('file name: katana-capture-YYYYMMDD-HHMMSS.json in local time', () => {
  assert.equal(exportFileName(new Date(2026, 10, 5, 9, 7, 3)), 'katana-capture-20261105-090703.json');
});

test('export contains header, identity and the event list', () => {
  const exported = buildExport(sampleSession());
  assert.equal(exported.format, 'katana-capture');
  assert.equal(exported.formatVersion, FORMAT_VERSION);
  assert.equal(exported.tool, 'Katana Studio capture tool');
  assert.equal(exported.startedAt, '2026-11-15T10:00:00.000Z');
  assert.equal(exported.identity, 'F0 7E 10 06 02 41 07 05 00 00 06 00 00 00 F7');
  assert.deepEqual(exported.filtered, { activeSensing: 1, clock: 0 });
  assert.deepEqual(exported.experiments, [{ id: 'Q1', title: 'Patch change', notes: 'line one\nline two' }]);
  assert.deepEqual(exported.events, [
    { t: 0, dir: 'out', bytes: 'F0 7E 7F 06 01 F7' },
    { t: 4.5, dir: 'in', bytes: 'F0 7E 10 06 02 41 07 05 00 00 06 00 00 00 F7' },
    { t: 2000, dir: 'marker', text: 'pressed channel A2 on the amp now' },
    { t: 2100.25, dir: 'in', bytes: 'F0 41 10 01 05 07 12 00 00 00 00 00 02 7E F7', reply: false },
  ]);
  // survives a JSON round-trip unchanged
  assert.deepEqual(JSON.parse(JSON.stringify(exported)), exported);
});

test('text export has one line per event with a decoded summary', () => {
  const lines = sessionToText(sampleSession()).trimEnd().split('\n');
  assert.ok(lines.includes('# notes Q1: line one / line two'));
  const body = lines.filter((l) => !l.startsWith('#'));
  assert.equal(body.length, 4);
  assert.match(body[0], /^ +0\.000 -> F0 7E 7F 06 01 F7 +; identity request$/);
  assert.match(body[1], /<- .*; identity reply, device 10, model code 06 \(KATANA-100\)$/);
  assert.match(body[2], /^ +2000\.000 ## pressed channel A2 on the amp now$/);
  assert.match(body[3], /; DT1 00 00 00 00 len 2 \| patch number \| index 2 \(A2\) \| UNSOLICITED$/);
});

test('describeBytes: DT1, RQ1 and other messages', () => {
  const name = Array.from('Clean Lead      ', (c) => c.charCodeAt(0));
  assert.equal(
    describeBytes(buildDt1(0x10, ADDR.currentPatch, name), { reply: true }),
    'DT1 20 00 00 00 len 16 | current patch +00 00 00 | name "Clean Lead" | reply');
  assert.equal(
    describeBytes(buildDt1(0x10, [0x21, 0x10, 0x58, 0x00], [1, 30, 40])),
    'DT1 21 10 58 00 len 3 | slot 8 B4 +00 58 00');
  assert.equal(
    describeBytes(buildRq1(0x10, ADDR.currentPatch, [0x00, 0x02, 0x00, 0x00])),
    'RQ1 20 00 00 00 size 00 02 00 00 (32768) | current patch +00 00 00');
  assert.equal(describeBytes(buildDt1(0x10, ADDR.editorMode, [1])), 'DT1 7F 00 00 01 len 1 | editor mode | value 01');
  const broken = buildDt1(0x10, ADDR.editorMode, [1]);
  broken[broken.length - 2] ^= 1;
  assert.match(describeBytes(broken), /BAD CHECKSUM$/);
  assert.equal(describeBytes([0x90, 0x40, 0x7f]), 'short message (status 90)');
  assert.equal(describeBytes([0xf0, 0x43, 0x01, 0xf7]), 'other SysEx');
});

test('describeAddress: memory areas', () => {
  assert.equal(describeAddress([0x10, 0x00, 0x02, 0x00]).area, 'system');
  assert.equal(describeAddress([0x20, 0x01, 0x7f, 0x7f]).area, 'current');
  assert.equal(describeAddress([0x20, 0x10, 0x00, 0x00]).slotIndex, 0);
  assert.equal(describeAddress([0x20, 0x70, 0x00, 0x00]).slotIndex, 6);
  assert.equal(describeAddress([0x21, 0x00, 0x00, 0x00]).slotIndex, 7);
  assert.equal(describeAddress([0x21, 0x20, 0x06, 0x01]).label, 'slot 9 PREVIEW +00 06 01');
  assert.equal(describeAddress([0x21, 0x30, 0x00, 0x00]).area, 'unknown');
  assert.equal(describeAddress([0x30, 0x00, 0x00, 0x00]).area, 'temp');
  assert.equal(describeAddress([0x7f, 0x00, 0x01, 0x04]).label, 'PATCH_WRITE');
});

test('experiment list: unique IDs Q1 to Q9, each with steps', () => {
  const ids = EXPERIMENTS.map((x) => x.id).sort();
  assert.deepEqual(ids, ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9']);
  for (const x of EXPERIMENTS) assert.ok(x.title && x.steps.length > 0);
});
