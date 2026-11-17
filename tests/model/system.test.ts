import { describe, expect, it } from 'vitest';
import { SYSTEM_BLOCKS } from '../../src/protocol/blocks';
import { PatchImage, readRaw, systemBlockAt } from '../../src/model/patch';
import { encodingSize } from '../../src/model/schema';
import { GAFC_SYSTEM_PARAMS, MIDI_CC_NUMBERS, SYSTEM_PARAMS } from '../../src/model/system';

/** SYSTEM as the amp of the owner held it (capture katana-probe-20261117-181446.json, snapshot B). */
const OWNER: readonly (readonly number[])[] = [
  [0x00],
  [0x14, 0x32, 0x19, 0x00, 0x32],
  [0x01, 0x00],
  [0x01, 0x00],
  [0x01, 0x01],
  [0x01, 0x00],
  [0x08, 0x14, 0x0c, 0x04, 0x0e, 0x19, 0x01, 0x14, 0x14, 0x0e, 0x14],
  [0x00, 0x14, 0x0d, 0x01, 0x14, 0x17, 0x01, 0x14, 0x14, 0x0e, 0x14],
  [0x08, 0x16, 0x08, 0x01, 0x14, 0x17, 0x01, 0x14, 0x14, 0x0e, 0x14],
  Array<number>(11).fill(0x18),
  [0x18, 0x18, 0x12, ...Array<number>(8).fill(0x18)],
  Array<number>(11).fill(0x18),
  [0x00, 0x01, 0x00],
  [0x04, 0x0a, 0x04, 0x00, 0x00],
  [0x02, 0x0a, 0x04, 0x00, 0x00],
  [0x00, 0x00, 0x14],
  [0x04],
  [0x07, 0x07, 0x07, 0x07, 0x07],
  [0x00],
  [
    0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x2f, 0x30, 0x31, 0x34, 0x32, 0x33, 0x38, 0x35, 0x36, 0x37, 0x39,
    0x3a, 0x3b,
  ],
  [0x04, 0x00, 0x01, 0x02, 0x03, 0x05, 0x06, 0x07, 0x08],
];
const image = PatchImage.system(new Map(SYSTEM_BLOCKS.map((b, i) => [b.offset, OWNER[i] ?? []] as const)));
const byKey = (key: string) => {
  const p = SYSTEM_PARAMS.find((d) => d.key === key);
  if (!p) throw new Error(key);
  return p;
};

describe('SYSTEM list', () => {
  it('the owner image is complete (21 blocks)', () => {
    expect(image.complete).toBe(true);
  });

  it('keys are unique and every parameter lies inside its block', () => {
    expect(new Set(SYSTEM_PARAMS.map((p) => p.key)).size).toBe(SYSTEM_PARAMS.length);
    for (const p of SYSTEM_PARAMS) {
      const b = systemBlockAt(p.at);
      expect(b, p.key).toBeDefined();
      expect(p.at + encodingSize(p.encoding), p.key).toBeLessThanOrEqual((b?.offset ?? 0) + (b?.length ?? 0));
    }
  });

  it('covers every SYSTEM byte once, except stereo expand (00 00) and power control (20 00)', () => {
    const covered = new Map<number, string>();
    for (const p of SYSTEM_PARAMS) {
      expect(covered.has(p.at), p.key).toBe(false);
      covered.set(p.at, p.key);
    }
    const all = SYSTEM_BLOCKS.flatMap((b) => Array.from({ length: b.length }, (_, i) => b.offset + i));
    const missing = all.filter((a) => !covered.has(a));
    expect(missing).toEqual([0x0000, 0x1000]);
    expect(SYSTEM_PARAMS).toHaveLength(129);
  });

  it('decodes the owner amp: Global EQ on with memory 1 parametric, GA-FC function mode all SOLO', () => {
    expect(readRaw(image, byKey('system.globalEq.on'))).toBe(1);
    expect(readRaw(image, byKey('system.globalEq.select'))).toBe(0);
    expect(readRaw(image, byKey('system.globalEq.1.position'))).toBe(1); // OUTPUT
    expect(readRaw(image, byKey('system.globalEq.1.peq.lowMidGain'))).toBe(0x0e); // −6 dB
    expect(GAFC_SYSTEM_PARAMS.map((p) => p.display?.table?.[readRaw(image, p) ?? -1])).toEqual(
      Array<string>(5).fill('SOLO ON/OFF'),
    );
    expect(readRaw(image, byKey('system.lineOut.airFeel'))).toBe(1); // LIVE
    expect(readRaw(image, byKey('system.usb.outLevel'))).toBe(50); // 100 %
  });

  it('every value of the owner amp lies in its range', () => {
    for (const p of SYSTEM_PARAMS) {
      const v = readRaw(image, p);
      expect(v, p.key).toBeGreaterThanOrEqual(p.min);
      expect(v, p.key).toBeLessThanOrEqual(p.max);
    }
  });

  it('MIDI CC numbers: CC#1–31 and CC#64–95, factory booster CC#16, EXP pedal CC#80', () => {
    expect(MIDI_CC_NUMBERS).toHaveLength(63);
    expect(MIDI_CC_NUMBERS[15]).toBe('CC#16');
    expect(MIDI_CC_NUMBERS[47]).toBe('CC#80');
  });
});
