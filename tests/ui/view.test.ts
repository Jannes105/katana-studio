import { describe, expect, it } from 'vitest';
import { PATCH_BLOCKS } from '../../src/protocol/blocks';
import { EFFECTS, NS_THRESHOLD, effectType } from '../../src/model/params';
import { PatchImage } from '../../src/model/patch';
import type { ConnectionState } from '../../src/state/connection';
import { connectionDot, dimmed, effectRows, hasPatch, paramView, rememberedHere } from '../../src/ui/view';

function image(threshold: number): PatchImage {
  const blocks = new Map(PATCH_BLOCKS.map((b) => [b.offset, new Array<number>(b.length).fill(0)]));
  return PatchImage.of(blocks).with(NS_THRESHOLD.at, [threshold]);
}

const base: ConnectionState = {
  phase: 'connected',
  device: 'mock',
  model: 'KATANA-100',
  modelCode: 6,
  readOnly: false,
  warnings: [],
  error: null,
  patchIndex: 1,
  patchName: 'X',
  current: image(40),
  stored: image(40),
  storedIndex: 1,
  unsaved: [],
  unsavedKnown: true,
  remembered: new Map(),
  reading: false,
  lastReadAt: 0,
  backingUp: false,
  saving: false,
};

describe('view helpers', () => {
  it('connection dot by phase', () => {
    expect(connectionDot(base)).toBe('ok');
    expect(connectionDot({ ...base, readOnly: true })).toBe('warn');
    expect(connectionDot({ ...base, phase: 'error' })).toBe('error');
    expect(connectionDot({ ...base, phase: 'waiting' })).toBe('off');
    expect(connectionDot({ ...base, phase: 'connecting' })).toBe('busy');
  });

  it('a parameter is changed only when the stored slot is known and differs', () => {
    expect(paramView(base, NS_THRESHOLD)).toEqual({ value: 40, stored: null, changed: false });
    const changed = { ...base, current: image(55) };
    expect(paramView(changed, NS_THRESHOLD)).toEqual({ value: 55, stored: 40, changed: true });
    expect(paramView({ ...changed, unsavedKnown: false }, NS_THRESHOLD)).toEqual({
      value: 55,
      stored: null,
      changed: false,
    });
    expect(paramView({ ...base, current: PatchImage.EMPTY }, NS_THRESHOLD).value).toBeUndefined();
  });

  it('values stay shown while unplugged, dimmed', () => {
    const frozen = { ...base, phase: 'waiting' as const };
    expect(hasPatch(frozen)).toBe(true);
    expect(dimmed(frozen)).toBe(true);
    expect(dimmed({ ...base, reading: true })).toBe(true);
    expect(dimmed(base)).toBe(false);
    expect(hasPatch({ ...base, current: PatchImage.EMPTY })).toBe(false);
  });

  it('effect rows: on/off, active variation, types, and what differs from the stored slot', () => {
    const mod = EFFECTS[1];
    if (!mod) throw new Error('no mod');
    const current = base.current
      .with(mod.switch.at, [1])
      .with(mod.colour.at, [1])
      .with(effectType(mod, 2).at, [7]);
    const rows = effectRows({ ...base, current });
    expect(rows.map((r) => r.key)).toEqual(['booster', 'mod', 'fx', 'delay', 'reverb']);
    const r = rows[1];
    expect(r).toMatchObject({ on: true, colour: 1, switchChanged: true, colourChanged: true, changed: true });
    expect(r?.typeNames).toEqual(['T.WAH', 'T.WAH', 'GUITAR SIM']);
    expect(r?.typeChanged).toEqual([false, false, true]);
    expect(rows[0]?.changed).toBe(false);
  });

  it('remembered changes of the channel shown', () => {
    const remembered = new Map([[2, [{ offset: NS_THRESHOLD.at, value: 70 }]]]);
    expect(rememberedHere({ ...base, remembered })).toEqual([]);
    expect(rememberedHere({ ...base, remembered, patchIndex: 2 })).toHaveLength(1);
  });
});
