/// <reference types="node" />
// Checks the parameter list against the real captures in captures/ (private, git-ignored; local only, never in
// CI). Every stored slot and current patch read in full must decode to plausible values: the derived offsets
// (amp type and variation, effect type blocks) would show up here as out-of-range values.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADDR, PANEL_INDEX, PREVIEW_INDEX, storedPatchAddress } from '../../src/protocol/address';
import { parseHex, parseMessage } from '../../src/protocol/sysex';
import { parseCapture } from '../../src/mock/capture';
import { AMP_TYPE_NAMES } from '../../src/model/params';
import { PatchImage, patchView } from '../../src/model/patch';

const DIR = join(__dirname, '..', '..', 'captures');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];

/** Every complete patch image in a capture (current patch and stored slots), labelled by its base. */
function images(file: string): { label: string; image: PatchImage }[] {
  const capture = parseCapture(readFileSync(join(DIR, file), 'utf8'));
  const bases = [
    { label: 'current', base: ADDR.currentPatch },
    ...Array.from({ length: PREVIEW_INDEX + 1 }, (_, i) => ({
      label: `slot ${i}`,
      base: storedPatchAddress(i),
    })),
  ];
  const seen = bases.map(() => new Map<number, readonly number[]>());
  const out: { label: string; image: PatchImage }[] = [];
  for (const e of capture.events) {
    if (e.dir !== 'in') continue;
    const m = parseMessage(parseHex(e.bytes));
    if (m.type !== 'dt1') continue;
    bases.forEach((b, i) => {
      const blocks = seen[i];
      if (!blocks) return;
      blocks.set(m.address, m.data);
      const image = PatchImage.fromReply(blocks, b.base);
      if (image.complete) {
        out.push({ label: b.label, image });
        blocks.clear();
      }
    });
  }
  return out;
}

describe.skipIf(files.length === 0)('parameter list against real captures (local only)', () => {
  const all = files.flatMap((f) => images(f).map((x) => ({ file: f, ...x })));

  it('finds complete patches in the captures', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it('every complete patch decodes to plausible values', () => {
    for (const { file, label, image } of all) {
      const where = `${file} ${label}`;
      const v = patchView(image);
      expect(v.name, where).toBeDefined();
      for (const k of ['gain', 'volume', 'bass', 'middle', 'treble', 'presence']) {
        expect(v.values.get(`amp.${k}`), `${where} ${k}`).toBeLessThanOrEqual(100);
      }
      expect(v.values.get('amp.type'), where).toBeLessThan(AMP_TYPE_NAMES.length);
      expect([0, 1], where).toContain(v.values.get('amp.variation'));
      expect([0, 1], where).toContain(v.values.get('ns.on'));
      expect(v.values.get('ns.threshold'), where).toBeLessThanOrEqual(100);
      for (const e of v.effects) {
        expect([true, false], `${where} ${e.key}`).toContain(e.on);
        expect([0, 1, 2], `${where} ${e.key}`).toContain(e.colour);
        for (const t of e.types) expect(t, `${where} ${e.key} type`).toBeLessThan(64);
      }
    }
  });

  it('panel and preview slots are among them', () => {
    const labels = new Set(all.map((x) => x.label));
    expect(labels).toContain(`slot ${PANEL_INDEX}`);
    expect(labels).toContain(`slot ${PREVIEW_INDEX}`);
  });
});
