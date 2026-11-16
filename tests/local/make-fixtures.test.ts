/// <reference types="node" />
// Generates the sanitized excerpts in tests/fixtures/ from the private captures (PLAN 4.7, 9.2 D 20). Patch names
// are replaced by neutral ones ("PATCH 1", …), values stay; notes are dropped. Runs only on request:
//
//   MAKE_FIXTURES=1 npx vitest run tests/local/make-fixtures
//
// The excerpts are chosen by marker text, so regenerating gives the same files.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCapture, sanitizeCapture, type Capture } from '../../src/mock/capture';

const CAPTURES = join(__dirname, '..', '..', 'captures');
const FIXTURES = join(__dirname, '..', 'fixtures');

interface Spec {
  /** Output name in tests/fixtures/ (without .json). */
  readonly name: string;
  readonly source: string;
  /** First marker of the excerpt (inclusive); from the start when missing. */
  readonly from?: string;
  /** Marker that ends the excerpt (exclusive); to the end when missing. */
  readonly until?: string;
  readonly notes: string;
}

export const SPECS: readonly Spec[] = [
  {
    name: 'full-patch-and-slots',
    source: 'katana-probe-20261115-182243.json',
    until: 'DT1 PATCH_SELECT index 2',
    notes:
      'Greeting reads, all ten stored slots in one range RQ1 (800 DT1), PATCH_SELECT index 1 with its burst, ' +
      'then the current patch in one range RQ1. Editor mode was on.',
  },
  {
    name: 'channel-change-on-amp',
    source: 'katana-probe-20261115-182715.json',
    notes:
      'Q1: channel buttons pressed on the amp with editor mode on, between two snapshots. Reported in this ' +
      'order: A4, A1, B1, B4, PANEL, B3, B2 (the marker text lists fewer). Shows the status bytes, ' +
      'the patch number report and, after it, the 30 00 02 00 block for PANEL.',
  },
  {
    name: 'knob-stream',
    source: 'katana-probe-20261115-182816.json',
    notes:
      'Q3: GAIN, BASS and VOLUME turned on the amp, BOOSTER button pressed, REVERB knob turned, editor mode on: ' +
      'one DT1 per value about every 50 ms.',
  },
  {
    name: 'save-on-amp',
    source: 'katana-probe-20261115-234350.json',
    notes:
      'B8: on B4, GAIN changed and saved on the amp (PATCH_WRITE report 7F 00 01 04 = 00 08), editor mode on.',
  },
];

function excerpt(capture: Capture, spec: Spec): Capture {
  const index = (text: string | undefined, fallback: number): number => {
    if (text === undefined) return fallback;
    const i = capture.events.findIndex((e) => e.dir === 'marker' && e.text === text);
    if (i < 0) throw new Error(`${spec.source}: marker "${text}" not found`);
    return i;
  };
  const events = capture.events.slice(index(spec.from, 0), index(spec.until, capture.events.length));
  return { ...sanitizeCapture({ ...capture, events }), notes: spec.notes };
}

/** One event per line, so diffs of a regenerated fixture stay readable. */
function toJson(c: Capture): string {
  const { events, ...head } = c;
  const lines = events.map((e) => JSON.stringify(e));
  return `${JSON.stringify(head).slice(0, -1)},"events":[\n${lines.join(',\n')}\n]}\n`;
}

const run = process.env.MAKE_FIXTURES === '1' && existsSync(CAPTURES);

describe.skipIf(!run)('make fixtures (on request only)', () => {
  it.each(SPECS)('$name', (spec) => {
    const capture = parseCapture(readFileSync(join(CAPTURES, spec.source), 'utf8'));
    const out = excerpt(capture, spec);
    expect(out.events.length).toBeGreaterThan(0);
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(join(FIXTURES, `${spec.name}.json`), toJson(out));
  });
});
