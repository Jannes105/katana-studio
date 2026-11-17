// Phase 1c: loading a patch from a file into a channel (restore) and renaming the current patch. Both only write
// the current patch; saving is the usual way (saving.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDR, addr, storedPatchAddress } from '../../src/protocol/address';
import { PATCH_BLOCKS } from '../../src/protocol/blocks';
import { patchName } from '../../src/protocol/encoding';
import { parseMessage } from '../../src/protocol/sysex';
import { MockAmp } from '../../src/mock/mock-amp';
import { MockDevice } from '../../src/mock/mock-device';
import { NS_THRESHOLD, PATCH_NAME } from '../../src/model/params';
import { patchNameFrom } from '../../src/model/patch';
import { AmpConnection } from '../../src/state/connection';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const SETTLE = 1000;
const KNOB_BLOCK = addr(0, 0x01, 0x1c, 0);

async function started(amp = new MockAmp()) {
  const device = new MockDevice(amp);
  const connection = new AmpConnection(device);
  void connection.start();
  await tick(SETTLE);
  return { amp, device, connection };
}

/** The stored patch of a channel on the mock, changed a little, as file blocks. */
function fileFrom(amp: MockAmp, index: number, name: string, ns: number): Map<string, number[]> {
  const base = storedPatchAddress(index);
  const blocks = new Map(PATCH_BLOCKS.map((b) => [b.key, [...(amp.peek(base + b.offset, b.length) ?? [])]]));
  blocks.set('000000', patchName.encode(name));
  const nsBlock = blocks.get('005800');
  if (nsBlock) nsBlock[1] = ns;
  blocks.set('011C00', [9, 9, 9, 9, 9]); // read-only knob positions: never written
  return blocks;
}

const dt1To = (amp: MockAmp, address: number) =>
  amp.received.map((m) => parseMessage(m)).filter((m) => m.type === 'dt1' && m.address === address);

async function load(connection: AmpConnection, blocks: Map<string, number[]>, index: number) {
  const pending = connection.loadPatch(blocks, index);
  await tick(SETTLE * 2);
  return pending;
}

describe('loading a patch from a file (PLAN 1c: restore)', () => {
  it('into the current channel: writes the differing blocks, reads back, nothing is saved', async () => {
    const { amp, connection } = await started();
    const result = await load(connection, fileFrom(amp, 1, 'FROM FILE', 77), 1);
    expect(result).toEqual({ kind: 'loaded', index: 1, written: 2 }); // name and NS block
    expect(amp.peek(ADDR.currentPatch + NS_THRESHOLD.at)).toEqual([77]);
    expect(connection.state.patchName).toBe('FROM FILE');
    expect(amp.peek(storedPatchAddress(1) + NS_THRESHOLD.at)).toEqual([40]); // the slot is untouched
    expect(dt1To(amp, ADDR.patchWrite)).toHaveLength(0);
    expect(dt1To(amp, ADDR.currentPatch + KNOB_BLOCK)).toHaveLength(0);
    expect(connection.state.unsaved).toContain(NS_THRESHOLD.at);
    expect(connection.state.loading).toBe(false);
  });

  it('into another channel: switches first, then loads; saving afterwards stores it there', async () => {
    const { amp, connection } = await started();
    const result = await load(connection, fileFrom(amp, 1, 'MOVED', 66), 6);
    expect(result).toMatchObject({ kind: 'loaded', index: 6 });
    expect(connection.state.patchIndex).toBe(6);
    expect(amp.patchNumber).toBe(6);
    expect(amp.peek(ADDR.currentPatch + NS_THRESHOLD.at)).toEqual([66]);

    const saving = connection.save();
    await tick(SETTLE);
    expect(await saving).toEqual({ kind: 'saved', index: 6 });
    expect(amp.peek(storedPatchAddress(6) + NS_THRESHOLD.at)).toEqual([66]);
  });

  it('keeps unsaved changes of the target as remembered changes', async () => {
    const { amp, connection } = await started();
    void connection.setValue(NS_THRESHOLD, 12);
    await tick(400);
    await load(connection, fileFrom(amp, 1, 'OVER', 55), 1);
    expect(connection.state.remembered.get(1)).toEqual([{ offset: NS_THRESHOLD.at, value: 12 }]);
  });

  it('refuses an incomplete patch, the Panel and while not writable', async () => {
    const { amp, device, connection } = await started();
    const blocks = fileFrom(amp, 1, 'X', 50);
    blocks.delete('005800');
    expect(await connection.loadPatch(blocks, 1)).toEqual({ kind: 'refused' });
    expect(await connection.loadPatch(fileFrom(amp, 1, 'X', 50), 0)).toEqual({ kind: 'refused' });
    device.unplug();
    await tick(10);
    expect(await connection.loadPatch(fileFrom(amp, 1, 'X', 50), 1)).toEqual({ kind: 'refused' });
  });

  it('a channel change on the amp while loading aborts', async () => {
    const { amp, connection } = await started();
    amp.silent = true; // the read-back never comes
    const pending = connection.loadPatch(fileFrom(amp, 1, 'X', 50), 1);
    await tick(20);
    amp.silent = false;
    amp.selectChannelOnAmp(3);
    await tick(SETTLE * 2);
    expect(await pending).toEqual({ kind: 'aborted', index: 1 });
  });
});

describe('renaming the current patch (PLAN 1c)', () => {
  it('writes the 16-byte name block, shows it at once, unsaved until saved; double tap brings it back', async () => {
    const { amp, connection } = await started();
    expect(await connection.setName('Glass Clean 2')).toBe('Glass Clean 2');
    await tick(20);
    expect(amp.peek(ADDR.currentPatch, 16)).toEqual(patchName.encode('Glass Clean 2'));
    expect(connection.state.patchName).toBe('Glass Clean 2');
    expect(connection.state.unsaved.length).toBeGreaterThan(0);

    const result = await connection.revertParam(PATCH_NAME);
    await tick(20);
    expect(connection.state.patchName).toBe('MOCK 1');
    expect(result?.previous.length).toBeGreaterThan(0);
  });

  it('cleans what the amp cannot store: umlauts, other characters, length', () => {
    expect(patchNameFrom('Größe ~ Übung')).toBe('Groesse  Uebung');
    expect(patchNameFrom('A very long patch name here')).toBe('A very long patc');
    expect(patchNameFrom('Clean   ')).toBe('Clean');
    expect(patchNameFrom('😀 Lead')).toBe(' Lead');
  });
});
