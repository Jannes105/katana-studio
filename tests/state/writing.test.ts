// Phase 1b: writing from the app: reset to the stored value, revert all, restore remembered changes, undo, and
// channel select by PATCH_SELECT (PLAN 4.5 rules 1, 2, 7; PLAN 2).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDR, addr } from '../../src/protocol/address';
import { parseMessage } from '../../src/protocol/sysex';
import { MockAmp } from '../../src/mock/mock-amp';
import { MockDevice } from '../../src/mock/mock-device';
import { AMP_GAIN, EFFECTS, NS_THRESHOLD } from '../../src/model/params';
import { readRaw } from '../../src/model/patch';
import { instanceParam } from '../../src/model/schema';
import { AmpConnection, writableParamAt } from '../../src/state/connection';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const SETTLE = 1000;
const NS = ADDR.currentPatch + NS_THRESHOLD.at;
const GAIN = ADDR.currentPatch + AMP_GAIN.at;
const delay = EFFECTS.find((g) => g.key === 'delay');
const timeDef = delay?.params.find((p) => p.key === 'time');
if (!delay || !timeDef) throw new Error('no delay time');
const DELAY_TIME = instanceParam(delay, 0, timeDef);
/** A mod parameter byte (the mod knob moves 1D 37, protocol-notes Q3); not in our list yet. */
const MOD_BYTE = addr(0, 0, 0x1d, 0x37);

async function started(amp = new MockAmp()) {
  const device = new MockDevice(amp);
  const connection = new AmpConnection(device);
  void connection.start();
  await tick(SETTLE);
  return { amp, device, connection };
}

const patchSelects = (amp: MockAmp) =>
  amp.received.map((m) => parseMessage(m)).filter((m) => m.type === 'dt1' && m.address === ADDR.patchSelect);

describe('writing: back to the stored state (rule 7)', () => {
  it('a double tap resets one parameter, undo brings the value back', async () => {
    const { amp, connection } = await started();
    void connection.setValue(NS_THRESHOLD, 70);
    await tick(20);
    expect(connection.state.unsaved).toEqual([NS_THRESHOLD.at]);

    const result = await connection.revertParam(NS_THRESHOLD);
    await tick(20);
    expect(amp.peek(NS)).toEqual([40]);
    expect(connection.state.unsaved).toEqual([]);
    expect(result?.previous).toEqual([{ offset: NS_THRESHOLD.at, value: 70 }]);

    if (!result) throw new Error('no result');
    await connection.undo(result);
    await tick(20);
    expect(amp.peek(NS)).toEqual([70]);
    expect(readRaw(connection.state.current, NS_THRESHOLD)).toBe(70);
  });

  it('a reset of an unchanged parameter writes nothing', async () => {
    const { amp, connection } = await started();
    const before = amp.received.length;
    const result = await connection.revertParam(NS_THRESHOLD);
    await tick(20);
    expect(result?.previous).toEqual([]);
    expect(amp.received.length).toBe(before);
  });

  it('revert all writes every changed parameter back, a time as a whole, and counts what it cannot write', async () => {
    const { amp, connection } = await started();
    const storedTime = readRaw(connection.state.stored, DELAY_TIME);
    void connection.setValue(NS_THRESHOLD, 70);
    void connection.setValue(AMP_GAIN, 12);
    void connection.setValue(DELAY_TIME, 1234);
    amp.turnKnob(ADDR.currentPatch + MOD_BYTE, (amp.peek(ADDR.currentPatch + MOD_BYTE)?.[0] ?? 0) ^ 1);
    await tick(400); // past the write guard, so the knob report is taken
    expect(connection.state.unsaved.length).toBeGreaterThanOrEqual(4);

    const result = await connection.revertAll();
    await tick(20);
    expect(amp.peek(NS)).toEqual([40]);
    expect(amp.peek(GAIN)).toEqual([readRaw(connection.state.stored, AMP_GAIN)]);
    expect(readRaw(connection.state.current, DELAY_TIME)).toBe(storedTime);
    expect(result?.skipped).toBe(1); // the mod byte: not in our list, left alone (PLAN 4.4)
    expect(connection.state.unsaved).toEqual([MOD_BYTE]);
  });

  it('undo is refused after a patch change', async () => {
    const { amp, connection } = await started();
    void connection.setValue(NS_THRESHOLD, 70);
    await tick(20);
    const result = await connection.revertParam(NS_THRESHOLD);
    if (!result) throw new Error('no result');
    amp.selectChannelOnAmp(6);
    await tick(SETTLE);
    expect(await connection.undo(result)).toBeNull();
  });

  it('every byte of the parameter list belongs to at most one writable parameter', () => {
    expect(writableParamAt(NS_THRESHOLD.at)?.key).toBe('ns.threshold');
    expect(writableParamAt(DELAY_TIME.at + 3)?.key).toBe('delay.0.time');
    expect(writableParamAt(MOD_BYTE)).toBeUndefined();
  });
});

describe('writing: remembered changes (PLAN 2)', () => {
  it('restore writes the remembered changes of the channel and forgets them', async () => {
    const { amp, connection } = await started();
    void connection.setValue(NS_THRESHOLD, 70);
    await tick(400);
    amp.selectChannelOnAmp(6);
    await tick(SETTLE);
    amp.selectChannelOnAmp(1);
    await tick(SETTLE);
    expect(amp.peek(NS)).toEqual([40]); // the amp has lost it
    expect(connection.state.remembered.get(1)).toHaveLength(1);

    const result = await connection.restoreRemembered();
    await tick(20);
    expect(result?.previous).toEqual([{ offset: NS_THRESHOLD.at, value: 40 }]);
    expect(amp.peek(NS)).toEqual([70]);
    expect(connection.state.remembered.has(1)).toBe(false);
  });

  it('restore does nothing on a channel without remembered changes', async () => {
    const { connection } = await started();
    expect(await connection.restoreRemembered()).toBeNull();
  });
});

describe('writing: channel select by PATCH_SELECT', () => {
  it('selects B2, follows it and remembers the unsaved changes of A1', async () => {
    const { amp, connection } = await started();
    void connection.setValue(NS_THRESHOLD, 70);
    await tick(400);
    expect(await connection.selectChannel(6)).toBe(true);
    await tick(SETTLE);
    expect(patchSelects(amp).map((m) => (m.type === 'dt1' ? m.data : []))).toEqual([[0, 6]]);
    expect(connection.state).toMatchObject({ patchIndex: 6, patchName: 'MOCK 6', reading: false });
    expect(connection.state.remembered.get(1)).toEqual([{ offset: NS_THRESHOLD.at, value: 70 }]);
  });

  it('refuses the Panel, PREVIEW, the active channel, and while reading', async () => {
    const { amp, connection } = await started();
    expect(await connection.selectChannel(0)).toBe(false);
    expect(await connection.selectChannel(9)).toBe(false);
    expect(await connection.selectChannel(1)).toBe(false); // active: would reload the slot
    void connection.readCurrent();
    expect(await connection.selectChannel(3)).toBe(false);
    await tick(SETTLE);
    expect(patchSelects(amp)).toHaveLength(0);
  });

  it('refuses when read-only or unplugged', async () => {
    const other = await started(new MockAmp({ modelCode: 0x07 }));
    expect(await other.connection.selectChannel(3)).toBe(false);
    const { device, connection, amp } = await started();
    device.unplug();
    await tick(10);
    expect(await connection.selectChannel(3)).toBe(false);
    expect(patchSelects(amp)).toHaveLength(0);
  });

  it('nothing is written while a backup runs', async () => {
    const { amp, connection } = await started();
    const backup = connection.readBackup({
      createdAt: '2026-11-16T00:00:00Z',
      appVersion: 'test',
      model: { code: 6, name: 'KATANA-100' },
    });
    await tick(1);
    void connection.setValue(NS_THRESHOLD, 70);
    expect(await connection.selectChannel(3)).toBe(false);
    await tick(SETTLE * 5);
    await backup;
    expect(amp.peek(NS)).toEqual([40]);
  });
});
