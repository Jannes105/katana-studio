import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDR, addr, storedPatchAddress } from '../../src/protocol/address';
import { u2x4 } from '../../src/protocol/encoding';
import { parseMessage } from '../../src/protocol/sysex';
import { MockAmp } from '../../src/mock/mock-amp';
import { MockDevice } from '../../src/mock/mock-device';
import { AmpConnection, NS_THRESHOLD, slotName, type ConnectionState } from '../../src/state/connection';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

async function started(amp = new MockAmp()) {
  const device = new MockDevice(amp);
  const connection = new AmpConnection(device);
  const states: ConnectionState[] = [];
  connection.subscribe((s) => states.push(s));
  void connection.start();
  await tick(500);
  return { amp, device, connection, states };
}

const writes = (amp: MockAmp) =>
  amp.received.map((m) => parseMessage(m)).filter((m) => m.type === 'dt1' && m.address === NS_THRESHOLD);

describe('AmpConnection', () => {
  it('connects on start, greets and reads the current patch', async () => {
    const { connection, states } = await started();
    expect(states[0]?.phase).toBe('starting');
    expect(states.map((s) => s.phase)).toContain('connecting');
    expect(connection.state).toMatchObject({
      phase: 'connected',
      model: 'KATANA-100',
      readOnly: false,
      patchIndex: 1,
      patchName: 'MOCK 1',
      nsThreshold: 40,
      reading: false,
    });
    expect(slotName(connection.state.patchIndex)).toBe('A1');
  });

  it('waits when no amp is attached, connects when it is plugged in', async () => {
    const device = new MockDevice();
    device.unplug();
    const connection = new AmpConnection(device);
    void connection.start();
    await tick(100);
    expect(connection.state.phase).toBe('waiting');
    device.plug();
    await tick(500);
    expect(connection.state.phase).toBe('connected');
  });

  it('writes the NS threshold, shows it at once and clamps it', async () => {
    const { amp, connection } = await started();
    void connection.setNsThreshold(55);
    expect(connection.state.nsThreshold).toBe(55);
    await tick(20);
    expect(amp.peek(NS_THRESHOLD)).toEqual([55]);
    void connection.setNsThreshold(140);
    await tick(20);
    expect(amp.peek(NS_THRESHOLD)).toEqual([100]);
    expect(connection.state.nsThreshold).toBe(100);
  });

  it('follows a knob report from the amp, but not within 300 ms of an own write', async () => {
    const { amp, connection } = await started();
    amp.turnKnob(NS_THRESHOLD, 70);
    await tick(20);
    expect(connection.state.nsThreshold).toBe(70);

    void connection.setNsThreshold(30);
    await tick(10);
    amp.turnKnob(NS_THRESHOLD, 80); // someone turns it at the same moment
    await tick(20);
    expect(connection.state.nsThreshold).toBe(30); // guarded
    await tick(400);
    amp.turnKnob(NS_THRESHOLD, 81);
    await tick(20);
    expect(connection.state.nsThreshold).toBe(81);
  });

  it('a patch change on the amp re-reads the current patch after the burst', async () => {
    const amp = new MockAmp();
    amp.poke(storedPatchAddress(6) + addr(0, 0, 0x58, 0x01), [12]);
    const { connection } = await started(amp);
    amp.selectChannelOnAmp(6);
    await tick(40); // the patch number comes at the end of the burst (after about 31 ms in the mock)
    expect(connection.state.reading).toBe(true);
    await tick(500);
    expect(connection.state).toMatchObject({
      patchIndex: 6,
      patchName: 'MOCK 6',
      nsThreshold: 12,
      reading: false,
    });
  });

  it('a patch change from the app (PATCH_SELECT) also re-reads', async () => {
    const amp = new MockAmp();
    const { connection, device } = await started(amp);
    await device.send(
      // as if another part of the app selected B1
      (await import('../../src/protocol/sysex')).buildDt1(0x10, ADDR.patchSelect, u2x4.encode(5)),
    );
    await tick(600);
    expect(connection.state).toMatchObject({ patchIndex: 5, patchName: 'MOCK 5' });
  });

  it('unplugging freezes the values and writes nothing; plugging in reconnects without writing', async () => {
    const { amp, device, connection } = await started();
    device.unplug();
    await tick(10);
    expect(connection.state.phase).toBe('waiting');
    expect(connection.state.nsThreshold).toBe(40); // frozen, still visible
    void connection.setNsThreshold(10);
    await tick(10);
    expect(amp.peek(NS_THRESHOLD)).toEqual([40]);

    const before = writes(amp).length;
    device.plug();
    await tick(500);
    expect(connection.state.phase).toBe('connected');
    expect(amp.editorMode).toBe(1); // switched on again after the "power cycle"
    expect(writes(amp).length).toBe(before); // rule 8: no parameter written on its own
  });

  it('goes read-only for another model and refuses to write', async () => {
    const amp = new MockAmp({ modelCode: 0x07 });
    const { connection } = await started(amp);
    expect(connection.state).toMatchObject({ phase: 'connected', readOnly: true });
    void connection.setNsThreshold(55);
    await tick(20);
    expect(amp.peek(NS_THRESHOLD)).toEqual([40]);
  });

  it('shows an error when the amp does not answer, and can retry', async () => {
    const amp = new MockAmp();
    amp.silent = true;
    const { connection } = await started(amp);
    await tick(1500);
    expect(connection.state.phase).toBe('error');
    expect(connection.state.error).toContain('No reply');
    amp.silent = false;
    void connection.connect();
    await tick(500);
    expect(connection.state.phase).toBe('connected');
  });

  it('keeps a log', async () => {
    const { connection, device } = await started();
    const entries: string[] = [];
    connection.log.subscribe((all) => entries.splice(0, entries.length, ...all.map((e) => e.text)));
    expect(entries.some((e) => e.includes('Greeting done: KATANA-100'))).toBe(true);
    device.unplug();
    expect(entries.at(-1)).toBe('Amp unplugged');
    connection.clearLog();
    expect(entries).toEqual([]);
  });
});
