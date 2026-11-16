import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDR, storedPatchAddress } from '../../src/protocol/address';
import { parseMessage } from '../../src/protocol/sysex';
import { MockAmp } from '../../src/mock/mock-amp';
import { MockDevice } from '../../src/mock/mock-device';
import { AmpConnection } from '../../src/state/connection';
import { parseFile, sameBytes, toJson } from '../../src/storage/format';
import { AMP_GAIN } from '../../src/model/params';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const meta = { createdAt: 'now', appVersion: 'test', model: { code: 6, name: 'KATANA-100' } };

async function started(amp = new MockAmp({ content: 'demo' })) {
  const device = new MockDevice(amp);
  const connection = new AmpConnection(device);
  void connection.start();
  await tick(1000);
  return { amp, device, connection };
}

/** Runs a backup to the end with fake timers. */
async function backup(connection: AmpConnection) {
  const p = connection.readBackup(meta);
  p.catch(() => {}); // awaited below; avoids an unhandled rejection while timers run
  await tick(5000);
  return p;
}

describe('complete backup (PLAN 4.6)', () => {
  it('reads SYSTEM, Panel and A1–B4 and the current patch with three range requests', async () => {
    const { amp, connection } = await started();
    const before = amp.received.length;
    const file = await backup(connection);
    const reads = amp.received
      .slice(before)
      .map((m) => parseMessage(m))
      .filter((m) => m.type === 'rq1');
    expect(reads.map((m) => m.type === 'rq1' && m.address)).toEqual([
      ADDR.system,
      ADDR.storedPatchBase,
      ADDR.currentPatch,
    ]);
    expect(file.slots.size).toBe(9);
    expect(file.slots.get(1)).toMatchObject({ channel: 'A1', name: 'Glass Clean' });
    expect(file.slots.get(0)?.channel).toBe('Panel');
    expect(file.current).toMatchObject({ channel: 'A1', name: 'Glass Clean' });
    expect(file.system.size).toBe(21);
    expect(connection.state.backingUp).toBe(false);
  });

  it('two backups in a row have the same raw bytes (PLAN 1a done criterion)', async () => {
    const { connection } = await started();
    const a = await backup(connection);
    const b = await backup(connection);
    expect(sameBytes(a, b)).toBe(true);
    expect(sameBytes(a, parseFile(toJson(b)))).toBe(true);
  });

  it('keeps the unsaved edit buffer apart from the stored slot', async () => {
    const { amp, connection } = await started();
    amp.turnKnob(ADDR.currentPatch + AMP_GAIN.at, 99);
    await tick(20);
    const file = await backup(connection);
    expect(file.current.blocks.get('000600')?.[0]).toBe(99);
    expect(file.slots.get(1)?.blocks.get('000600')?.[0]).not.toBe(99);
  });

  it('never reads the PREVIEW slot', async () => {
    const { amp, connection } = await started();
    const before = amp.received.length;
    await backup(connection);
    const slotRead = amp.received
      .slice(before)
      .map((m) => parseMessage(m))
      .find((m) => m.type === 'rq1' && m.address === ADDR.storedPatchBase);
    expect(slotRead?.type === 'rq1' && slotRead.address + slotRead.size).toBe(storedPatchAddress(9));
  });

  it('a pulled cable aborts the whole backup (no half file)', async () => {
    const { device, connection } = await started();
    const p = connection.readBackup(meta);
    p.catch(() => {});
    await tick(500); // inside the slots read
    device.unplug();
    await tick(100);
    await expect(p).rejects.toThrow('Backup aborted');
    expect(connection.state.backingUp).toBe(false);
  });

  it('a channel change during the backup aborts it', async () => {
    const { amp, connection } = await started();
    const p = connection.readBackup(meta);
    p.catch(() => {});
    await tick(500);
    amp.selectChannelOnAmp(5);
    await tick(2000);
    await expect(p).rejects.toThrow('Backup aborted');
  });

  it('refuses while not connected', async () => {
    const { device, connection } = await started();
    device.unplug();
    await expect(connection.readBackup(meta)).rejects.toThrow('Not connected');
  });

  it('the current patch file needs no read', async () => {
    const { amp, connection } = await started();
    const before = amp.received.length;
    const file = connection.currentPatchFile(meta);
    expect(file).toMatchObject({ kind: 'patch', current: { channel: 'A1', name: 'Glass Clean' } });
    expect(file.current.blocks.size).toBe(80);
    expect(amp.received.length).toBe(before);
  });
});
