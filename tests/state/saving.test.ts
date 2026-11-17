// Phase 1c: saving onto the current channel (PLAN 4.5 rule 10, protocol-notes 2.15): PATCH_WRITE only after
// confirmation (the UI asks; the state refuses what must never happen), wait for the acknowledgement, read the
// slot back and compare.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDR, storedPatchAddress } from '../../src/protocol/address';
import { parseMessage } from '../../src/protocol/sysex';
import { MockAmp } from '../../src/mock/mock-amp';
import { MockDevice } from '../../src/mock/mock-device';
import { NS_THRESHOLD } from '../../src/model/params';
import { AmpConnection, SAVE_ACK_TIMEOUT_MS } from '../../src/state/connection';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const SETTLE = 1000;

async function started(amp = new MockAmp()) {
  const device = new MockDevice(amp);
  const connection = new AmpConnection(device);
  void connection.start();
  await tick(SETTLE);
  return { amp, device, connection };
}

const patchWrites = (amp: MockAmp) =>
  amp.received.map((m) => parseMessage(m)).filter((m) => m.type === 'dt1' && m.address === ADDR.patchWrite);

/** Starts saving and lets the mock answer. */
async function save(connection: AmpConnection, ms = SETTLE) {
  const pending = connection.save();
  await tick(ms);
  return pending;
}

describe('saving (rule 10)', () => {
  it('saves the current patch onto its channel, checks the slot and shows "saved"', async () => {
    const { amp, connection } = await started();
    void connection.setValue(NS_THRESHOLD, 70);
    await tick(20);
    expect(connection.state.unsaved).toEqual([NS_THRESHOLD.at]);

    const result = await save(connection);
    expect(result).toEqual({ kind: 'saved', index: 1 });
    expect(patchWrites(amp)).toHaveLength(1);
    expect(amp.peek(storedPatchAddress(1) + NS_THRESHOLD.at)).toEqual([70]);
    expect(connection.state.unsaved).toEqual([]);
    expect(connection.state.unsavedKnown).toBe(true);
    expect(connection.state.saving).toBe(false);
  });

  it('locks writing while saving', async () => {
    const { amp, connection } = await started();
    const pending = connection.save();
    expect(connection.state.saving).toBe(true);
    expect(connection.canWrite()).toBe(false);
    void connection.setValue(NS_THRESHOLD, 70);
    expect(await connection.save()).toEqual({ kind: 'refused' }); // no second save at the same time
    await tick(SETTLE);
    await pending;
    expect(amp.peek(ADDR.currentPatch + NS_THRESHOLD.at)).toEqual([40]);
    expect(patchWrites(amp)).toHaveLength(1);
  });

  it('the second acknowledgement does not trigger another read or log a save on the amp', async () => {
    const { connection } = await started();
    await save(connection);
    const lines = (connection as unknown as { logEntries: { text: string }[] }).logEntries.map((e) => e.text);
    expect(lines.filter((l) => l.startsWith('Saved on '))).toEqual([]); // that is the "saved on the amp" line
    expect(lines.filter((l) => l.startsWith('Saved onto A1 and checked'))).toHaveLength(1);
  });

  it('forgets the remembered changes of the channel it saved', async () => {
    const { amp, connection } = await started();
    void connection.setValue(NS_THRESHOLD, 70);
    await tick(400);
    amp.selectChannelOnAmp(6);
    await tick(SETTLE);
    amp.selectChannelOnAmp(1);
    await tick(SETTLE);
    expect(connection.state.remembered.has(1)).toBe(true);
    await save(connection);
    expect(connection.state.remembered.has(1)).toBe(false);
  });

  it('never saves the Panel, and refuses while reading, read-only or unplugged', async () => {
    const { amp, device, connection } = await started();
    amp.selectChannelOnAmp(0);
    await tick(SETTLE);
    expect(await connection.save()).toEqual({ kind: 'refused' });

    amp.selectChannelOnAmp(2);
    await tick(10); // the patch change is pending, reading follows
    expect(await connection.save()).toEqual({ kind: 'refused' });
    await tick(SETTLE);

    device.unplug();
    await tick(10);
    expect(await connection.save()).toEqual({ kind: 'refused' });
    expect(patchWrites(amp)).toHaveLength(0);

    const other = await started(new MockAmp({ modelCode: 0x03 }));
    expect(other.connection.state.readOnly).toBe(true);
    expect(await other.connection.save()).toEqual({ kind: 'refused' });
    expect(patchWrites(other.amp)).toHaveLength(0);
  });
});

describe('saving: simulated faults show a clear result (PLAN 1c done criterion)', () => {
  it('no acknowledgement within 2 s: "no-ack", the slot is not touched', async () => {
    const { amp, connection } = await started();
    amp.saveFault = 'no-ack';
    void connection.setValue(NS_THRESHOLD, 70);
    await tick(20);
    const result = await save(connection, SAVE_ACK_TIMEOUT_MS + 100);
    expect(result).toEqual({ kind: 'no-ack', index: 1 });
    expect(amp.peek(storedPatchAddress(1) + NS_THRESHOLD.at)).toEqual([40]);
    expect(connection.state.unsaved).toEqual([NS_THRESHOLD.at]);
    expect(connection.state.saving).toBe(false);
  });

  it('the slot read back differs: "mismatch" names the block, and the difference shows as unsaved', async () => {
    const { amp, connection } = await started();
    amp.saveFault = 'wrong-content';
    const result = await save(connection);
    expect(result).toEqual({ kind: 'mismatch', index: 1, blocks: ['005800'] });
    expect(connection.state.unsaved).toEqual([NS_THRESHOLD.at]);
  });

  it('unplugged while waiting: "aborted"', async () => {
    const { amp, device, connection } = await started();
    amp.silent = true;
    const pending = connection.save();
    await tick(50);
    device.unplug();
    await tick(50);
    expect(await pending).toEqual({ kind: 'aborted', index: 1 });
    expect(connection.state.saving).toBe(false);
  });

  it('a channel change on the amp while waiting: "aborted"', async () => {
    const { amp, connection } = await started();
    amp.saveFault = 'no-ack';
    const pending = connection.save();
    await tick(50);
    amp.selectChannelOnAmp(3);
    await tick(SETTLE);
    expect(await pending).toEqual({ kind: 'aborted', index: 1 });
  });
});
