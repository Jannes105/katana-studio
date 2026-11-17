import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDR, addr, storedPatchAddress } from '../../src/protocol/address';
import { u2x4 } from '../../src/protocol/encoding';
import { buildDt1, parseMessage } from '../../src/protocol/sysex';
import { MockAmp } from '../../src/mock/mock-amp';
import { MockDevice } from '../../src/mock/mock-device';
import { AMP_GAIN, NS_THRESHOLD, EFFECTS, effectType } from '../../src/model/params';
import { readRaw } from '../../src/model/patch';
import { ASSIGN_PARAMS } from '../../src/model/assigns';
import { SYSTEM_PARAMS } from '../../src/model/system';
import { instanceParam, type ParamDef } from '../../src/model/schema';
import { AmpConnection, slotName, type ConnectionState } from '../../src/state/connection';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
/** Long enough for greeting, current patch and stored slot (mock: about 3 ms per block, 2 × 80 blocks). */
const SETTLE = 1000;
const NS = ADDR.currentPatch + NS_THRESHOLD.at;
const GAIN = ADDR.currentPatch + AMP_GAIN.at;

async function started(amp = new MockAmp()) {
  const device = new MockDevice(amp);
  const connection = new AmpConnection(device);
  const states: ConnectionState[] = [];
  connection.subscribe((s) => states.push(s));
  void connection.start();
  await tick(SETTLE);
  return { amp, device, connection, states };
}

const threshold = (c: AmpConnection) => readRaw(c.state.current, NS_THRESHOLD);
const paramWrites = (amp: MockAmp) =>
  amp.received
    .map((m) => parseMessage(m))
    .filter((m) => m.type === 'dt1' && m.address >= ADDR.currentPatch && m.address < ADDR.storedPatchBase);

describe('AmpConnection: connecting and reading', () => {
  it('connects on start, greets, reads the whole current patch and its stored slot', async () => {
    const { connection, states, amp } = await started();
    expect(states[0]?.phase).toBe('starting');
    expect(states.map((s) => s.phase)).toContain('connecting');
    const s = connection.state;
    expect(s).toMatchObject({
      phase: 'connected',
      model: 'KATANA-100',
      readOnly: false,
      patchIndex: 1,
      patchName: 'MOCK 1',
      storedIndex: 1,
      unsavedKnown: true,
      unsaved: [],
      reading: false,
    });
    expect(s.current.complete).toBe(true);
    expect(s.stored.complete).toBe(true);
    expect(threshold(connection)).toBe(40);
    expect(slotName(s.patchIndex)).toBe('A1');
    // One range request for the patch, one for the slot (rule 4), not one request per block.
    const reads = amp.received.map((m) => parseMessage(m)).filter((m) => m.type === 'rq1');
    expect(reads.filter((m) => m.type === 'rq1' && m.address === ADDR.currentPatch)).toHaveLength(1);
    expect(reads.filter((m) => m.type === 'rq1' && m.address === storedPatchAddress(1))).toHaveLength(1);
  });

  it('waits when no amp is attached, connects when it is plugged in', async () => {
    const device = new MockDevice();
    device.unplug();
    const connection = new AmpConnection(device);
    void connection.start();
    await tick(100);
    expect(connection.state.phase).toBe('waiting');
    device.plug();
    await tick(SETTLE);
    expect(connection.state.phase).toBe('connected');
  });

  it('a knob turned on the amp during the read is not lost (the block came first)', async () => {
    const { amp, connection } = await started();
    void connection.readCurrent();
    await tick(100); // the amp block (4th of 80) has arrived, the read is still running
    expect(connection.state.reading).toBe(true);
    amp.turnKnob(GAIN, 77);
    await tick(SETTLE);
    expect(readRaw(connection.state.current, AMP_GAIN)).toBe(77);
    expect(connection.state.unsaved).toEqual([AMP_GAIN.at]);
  });

  it('reads again when the app returns to the foreground (rule 5)', async () => {
    const { amp, connection } = await started();
    amp.poke(NS, [33]); // changed without a report (e.g. while the app was in the background)
    connection.onForeground();
    expect(connection.state.reading).toBe(true);
    await tick(SETTLE);
    expect(threshold(connection)).toBe(33);
  });
});

describe('AmpConnection: values, reports and "unsaved"', () => {
  it('writes a value, shows it at once, clamps it and marks it unsaved', async () => {
    const { amp, connection } = await started();
    void connection.setValue(NS_THRESHOLD, 55);
    expect(threshold(connection)).toBe(55);
    expect(connection.state.unsaved).toEqual([NS_THRESHOLD.at]);
    await tick(20);
    expect(amp.peek(NS)).toEqual([55]);
    void connection.setValue(NS_THRESHOLD, 140);
    await tick(20);
    expect(amp.peek(NS)).toEqual([100]);
  });

  it('never writes read-only parameters', async () => {
    const { amp, connection } = await started();
    const before = paramWrites(amp).length;
    void connection.setValue({ ...NS_THRESHOLD, readonly: true }, 3);
    await tick(20);
    expect(paramWrites(amp).length).toBe(before);
  });

  it('clamps an effect type to its table of names (once confirmed)', async () => {
    const { amp, connection } = await started();
    const reverb = EFFECTS.find((g) => g.key === 'reverb');
    if (!reverb) throw new Error('no reverb');
    const type: ParamDef = { ...effectType(reverb, 0), status: 'C' };
    void connection.setValue(type, 99);
    await tick(20);
    expect(amp.peek(ADDR.currentPatch + type.at)).toEqual([reverb.typeNames.length - 1]);
  });

  it('never writes an address that is not confirmed on the amp (status D)', async () => {
    const { amp, connection } = await started();
    const before = paramWrites(amp).length;
    void connection.setValue({ ...NS_THRESHOLD, status: 'D' }, 12);
    await tick(20);
    expect(paramWrites(amp).length).toBe(before);
  });

  it('writes a variation parameter at its instance address, a time as four nibbles', async () => {
    const { amp, connection } = await started();
    const delay = EFFECTS.find((g) => g.key === 'delay');
    const def = delay?.params.find((p) => p.key === 'time');
    if (!delay || !def) throw new Error('no delay time');
    const time = { ...instanceParam(delay, 2, def), status: 'C' as const };
    expect(time.key).toBe('delay.2.time');
    void connection.setValue(time, 5000);
    await tick(20);
    // Delay variation 2 is block 2C 00; the time is bytes 1–4, clamped to 2000 ms = 0x7D0.
    expect(amp.peek(ADDR.currentPatch + addr(0, 0, 0x2c, 0x01), 4)).toEqual([0, 7, 13, 0]);
    expect(readRaw(connection.state.current, time)).toBe(2000);
  });

  it('a new assign target sets min/max to its full range; min/max are clamped to the target', async () => {
    const { amp, connection } = await started();
    const p = (key: string): ParamDef => {
      const d = ASSIGN_PARAMS.find((x) => x.key === key);
      if (!d) throw new Error(key);
      return d;
    };
    const [target, min, max] = ['target', 'min', 'max'].map((k) => p(`assign.exp.delay.${k}`)) as [
      ParamDef,
      ParamDef,
      ParamDef,
    ];
    void connection.setValue(target, 1); // Time, 1–2000 ms
    await tick(20);
    expect(amp.peek(ADDR.currentPatch + target.at)).toEqual([1]);
    expect(readRaw(connection.state.current, min)).toBe(1);
    expect(readRaw(connection.state.current, max)).toBe(2000);
    void connection.setValue(target, 2); // Feedback, 0–100
    await tick(20);
    expect(amp.peek(ADDR.currentPatch + max.at, 4)).toEqual([0, 0, 6, 4]);
    expect(readRaw(connection.state.current, min)).toBe(0);
    void connection.setValue(max, 1800); // the amp would keep 1800; the app clamps to the target
    await tick(20);
    expect(readRaw(connection.state.current, max)).toBe(100);
  });

  it('follows a knob report from the amp, but not within 300 ms of an own write (rule 2)', async () => {
    const { amp, connection } = await started();
    amp.turnKnob(NS, 70);
    await tick(20);
    expect(threshold(connection)).toBe(70);
    expect(connection.state.unsaved).toEqual([NS_THRESHOLD.at]);

    void connection.setValue(NS_THRESHOLD, 30);
    await tick(10);
    amp.turnKnob(NS, 80); // someone turns it at the same moment
    await tick(20);
    expect(threshold(connection)).toBe(30); // guarded
    await tick(400);
    amp.turnKnob(NS, 81);
    await tick(20);
    expect(threshold(connection)).toBe(81);
  });

  it('turning a value back to the stored one clears "unsaved"', async () => {
    const { amp, connection } = await started();
    amp.turnKnob(NS, 70);
    await tick(20);
    amp.turnKnob(NS, 40);
    await tick(20);
    expect(connection.state.unsaved).toEqual([]);
  });

  it('saving on the amp re-reads the slot: nothing is unsaved afterwards', async () => {
    const { amp, connection } = await started();
    amp.turnKnob(NS, 70);
    await tick(20);
    expect(connection.state.unsaved).toHaveLength(1);
    amp.saveOnAmp();
    await tick(SETTLE);
    expect(connection.state.unsaved).toEqual([]);
    expect(readRaw(connection.state.stored, NS_THRESHOLD)).toBe(70);
  });
});

describe('AmpConnection: channel changes', () => {
  it('a patch change on the amp re-reads the current patch and its slot after the burst', async () => {
    const amp = new MockAmp();
    amp.poke(storedPatchAddress(6) + NS_THRESHOLD.at, [12]);
    const { connection } = await started(amp);
    amp.selectChannelOnAmp(6);
    await tick(40); // the patch number comes at the end of the burst (after about 31 ms in the mock)
    expect(connection.state.reading).toBe(true);
    await tick(SETTLE);
    expect(connection.state).toMatchObject({
      patchIndex: 6,
      patchName: 'MOCK 6',
      storedIndex: 6,
      unsavedKnown: true,
      reading: false,
    });
    expect(threshold(connection)).toBe(12);
  });

  it('appears well within 2 s (PLAN 1a done criterion)', async () => {
    const { amp, connection } = await started();
    amp.selectChannelOnAmp(5);
    let at = -1;
    for (let t = 0; t < 2000 && at < 0; t += 10) {
      await tick(10);
      if (connection.state.patchName === 'MOCK 5' && !connection.state.reading) at = t;
    }
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(2000);
  });

  it('a patch change from the app (PATCH_SELECT) also re-reads', async () => {
    const { connection, device } = await started();
    // as if another part of the app selected B1
    await device.send(buildDt1(0x10, ADDR.patchSelect, u2x4.encode(5)));
    await tick(SETTLE);
    expect(connection.state).toMatchObject({ patchIndex: 5, patchName: 'MOCK 5', storedIndex: 5 });
  });

  it('remembers the unsaved changes of the channel that was left (PLAN 2), until discarded', async () => {
    const { amp, connection } = await started();
    amp.turnKnob(NS, 70);
    await tick(20);
    amp.selectChannelOnAmp(6);
    await tick(SETTLE);
    expect(connection.state.remembered.get(1)).toEqual([{ offset: NS_THRESHOLD.at, value: 70 }]);
    expect(connection.state.unsaved).toEqual([]); // B2 itself is unchanged

    amp.selectChannelOnAmp(1); // back: the amp has lost the change, the app has not
    await tick(SETTLE);
    expect(threshold(connection)).toBe(40);
    expect(connection.state.remembered.get(1)).toHaveLength(1);
    connection.discardRemembered(1);
    expect(connection.state.remembered.has(1)).toBe(false);
  });

  it('saving on the amp forgets what was remembered for that channel', async () => {
    const { amp, connection } = await started();
    amp.turnKnob(NS, 70);
    await tick(20);
    amp.selectChannelOnAmp(6);
    await tick(SETTLE);
    amp.selectChannelOnAmp(1);
    await tick(SETTLE);
    expect(connection.state.remembered.has(1)).toBe(true);
    amp.saveOnAmp();
    await tick(SETTLE);
    expect(connection.state.remembered.has(1)).toBe(false);
  });
});

describe('AmpConnection: disconnects and errors', () => {
  it('unplugging freezes the values and writes nothing; plugging in reconnects and reads without writing', async () => {
    const { amp, device, connection } = await started();
    device.unplug();
    await tick(10);
    expect(connection.state.phase).toBe('waiting');
    expect(threshold(connection)).toBe(40); // frozen, still visible
    void connection.setValue(NS_THRESHOLD, 10);
    await tick(10);
    expect(amp.peek(NS)).toEqual([40]);

    amp.poke(NS, [44]); // changed on the amp while unplugged
    const before = paramWrites(amp).length;
    device.plug();
    await tick(SETTLE);
    expect(connection.state.phase).toBe('connected');
    expect(threshold(connection)).toBe(44); // read again after reconnecting
    expect(amp.editorMode).toBe(1); // switched on again after the "power cycle"
    expect(paramWrites(amp).length).toBe(before); // rule 8: no parameter written on its own
  });

  it('reconnects every time after ten unplug/plug cycles (PLAN 1a done criterion)', async () => {
    const { device, connection } = await started();
    for (let i = 0; i < 10; i++) {
      device.unplug();
      await tick(50);
      expect(connection.state.phase).toBe('waiting');
      device.plug();
      await tick(SETTLE);
      expect(connection.state).toMatchObject({ phase: 'connected', reading: false, patchName: 'MOCK 1' });
    }
  });

  it('goes read-only for another model and refuses to write', async () => {
    const amp = new MockAmp({ modelCode: 0x07 });
    const { connection } = await started(amp);
    expect(connection.state).toMatchObject({ phase: 'connected', readOnly: true });
    void connection.setValue(NS_THRESHOLD, 55);
    await tick(20);
    expect(amp.peek(NS)).toEqual([40]);
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
    await tick(SETTLE);
    expect(connection.state.phase).toBe('connected');
  });

  it('keeps a log', async () => {
    const { connection, device } = await started();
    const entries: string[] = [];
    connection.log.subscribe((all) => entries.splice(0, entries.length, ...all.map((e) => e.text)));
    expect(entries.some((e) => e.includes('Greeting done: KATANA-100'))).toBe(true);
    expect(entries.some((e) => e.includes('Read A1 "MOCK 1": 80 blocks'))).toBe(true);
    device.unplug();
    expect(entries.at(-1)).toBe('Amp unplugged');
    connection.clearLog();
    expect(entries).toEqual([]);
  });
});

describe('AmpConnection: SYSTEM (Phase 3)', () => {
  const sw2 = (): ParamDef => {
    const d = SYSTEM_PARAMS.find((p) => p.key === 'system.gafc.sw2');
    if (!d) throw new Error('no sw2');
    return d;
  };

  it('reads SYSTEM after connecting', async () => {
    const { amp, connection } = await started();
    expect(connection.state.system.complete).toBe(true);
    const reads = amp.received.map((m) => parseMessage(m)).filter((m) => m.type === 'rq1');
    expect(reads.some((m) => m.type === 'rq1' && m.address === ADDR.system)).toBe(true);
  });

  it('writes a SYSTEM parameter at 10 00 xx xx, shows it at once, clamps it', async () => {
    const { amp, connection } = await started();
    void connection.setSystemValue(sw2(), 4);
    expect(readRaw(connection.state.system, sw2())).toBe(4);
    await tick(20);
    expect(amp.peek(ADDR.system + sw2().at)).toEqual([4]);
    void connection.setSystemValue(sw2(), 99);
    await tick(20);
    expect(amp.peek(ADDR.system + sw2().at)).toEqual([9]);
  });

  it('follows a SYSTEM report from the amp', async () => {
    const { amp, connection } = await started();
    amp.turnKnob(ADDR.system + sw2().at, 6);
    await tick(20);
    expect(readRaw(connection.state.system, sw2())).toBe(6);
  });

  it('never writes SYSTEM while it has not been read, or a parameter not confirmed', async () => {
    const { amp, connection } = await started();
    const before = amp.received.length;
    void connection.setSystemValue({ ...sw2(), status: 'D' }, 2);
    await tick(20);
    expect(amp.received.length).toBe(before);
  });
});
