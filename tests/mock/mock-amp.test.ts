import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDR, SIZE, addr, storedPatchAddress } from '../../src/protocol/address';
import { patchName, u2x4 } from '../../src/protocol/encoding';
import { greet } from '../../src/protocol/greeting';
import { SendQueue, QueueTimeoutError } from '../../src/protocol/queue';
import {
  buildDt1,
  buildRq1,
  parseMessage,
  type Dt1Message,
  type ParsedMessage,
} from '../../src/protocol/sysex';
import { MockAmp } from '../../src/mock/mock-amp';

const NS_THRESHOLD = addr(0x20, 0x00, 0x58, 0x01);
const GAIN = addr(0x20, 0x00, 0x06, 0x00);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Runs `promise` while advancing fake time. */
async function run<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let settled = false;
  const p = promise.finally(() => (settled = true));
  for (let i = 0; i < ms && !settled; i += 10) await vi.advanceTimersByTimeAsync(10);
  return p;
}

async function connectedMock(options = {}) {
  const amp = new MockAmp(options);
  const queue = new SendQueue(amp);
  const reports: Dt1Message[] = [];
  queue.onMessage((m: ParsedMessage) => {
    if (m.type === 'dt1') reports.push(m);
  });
  const greeting = await run(greet(queue));
  reports.length = 0; // only what comes after the greeting
  return { amp, queue, reports, greeting };
}

describe('mock amp: greeting and reads', () => {
  it('greets like the real amp and has editor mode on afterwards', async () => {
    const { amp, greeting } = await connectedMock();
    expect(greeting).toMatchObject({
      deviceId: 0x10,
      modelCode: 0x06,
      editorLevel: 1,
      editorMode: 1,
      warnings: [],
    });
    expect(amp.editorMode).toBe(1);
  });

  it('reads a whole patch with one RQ1: 80 blocks, 2649 bytes, about 0.25 s', async () => {
    const { queue } = await connectedMock();
    const start = Date.now();
    const reply = await run(queue.read(ADDR.currentPatch, SIZE.patch));
    expect(reply.blocks.size).toBe(80);
    expect([...reply.blocks.values()].reduce((s, d) => s + d.length, 0)).toBe(2649);
    expect(Date.now() - start).toBeLessThan(300);
    expect(patchName.decode([...(reply.blocks.get(ADDR.currentPatch) ?? [])])).toBe('MOCK 1');
  });

  it('reads all ten stored slots: 800 blocks', async () => {
    const { queue } = await connectedMock();
    const reply = await run(queue.read(ADDR.storedPatchBase, addr(0x01, 0x20, 0x00, 0x00)), 5000);
    expect(reply.blocks.size).toBe(800);
  });

  it('answers a single read inside a block with just those bytes', async () => {
    const { queue } = await connectedMock();
    expect(await run(queue.readBytes(NS_THRESHOLD, 1))).toEqual([40]);
    expect(await run(queue.readBytes(ADDR.patchNumber, 2))).toEqual([0, 1]);
  });

  it('does not answer a range read over the command area (protocol-notes 2.9)', async () => {
    const { amp, queue } = await connectedMock();
    const read = queue.read(ADDR.editorLevel, 16);
    const failed = expect(read).rejects.toBeInstanceOf(QueueTimeoutError);
    await vi.advanceTimersByTimeAsync(1100);
    await failed;
    expect(amp.received.filter((m) => parseMessage(m).type === 'rq1').length).toBeGreaterThanOrEqual(2); // retry
  });

  it('a silent amp makes the greeting fail', async () => {
    const amp = new MockAmp();
    amp.silent = true;
    const queue = new SendQueue(amp);
    const g = greet(queue);
    const failed = expect(g).rejects.toBeInstanceOf(QueueTimeoutError);
    await vi.advanceTimersByTimeAsync(1100);
    await failed;
  });

  it('reports another model code, and the greeting writes nothing then', async () => {
    const amp = new MockAmp({ modelCode: 0x07 });
    const queue = new SendQueue(amp);
    const g = await run(greet(queue));
    expect(g.readOnly).toBe(true);
    expect(amp.editorMode).toBe(0);
    expect(amp.received.some((m) => parseMessage(m).type === 'dt1')).toBe(false);
  });
});

describe('mock amp: writes', () => {
  it('stores a parameter write without echo; it reads back', async () => {
    const { amp, queue, reports } = await connectedMock();
    await run(queue.write(NS_THRESHOLD, [55]));
    await vi.advanceTimersByTimeAsync(800);
    expect(reports).toEqual([]); // no echo (protocol-notes 2.13)
    expect(amp.peek(NS_THRESHOLD)).toEqual([55]);
    expect(await run(queue.readBytes(NS_THRESHOLD, 1))).toEqual([55]);
  });

  it('PATCH_SELECT: loads the slot and sends the burst of Q6', async () => {
    const { amp, queue, reports } = await connectedMock();
    await run(queue.write(ADDR.patchSelect, u2x4.encode(5)));
    await vi.advanceTimersByTimeAsync(200);
    expect(amp.patchNumber).toBe(5);
    expect(amp.peek(ADDR.currentPatch, 16)).toEqual(patchName.encode('MOCK 5'));
    const addresses = reports.map((r) => r.address);
    expect(addresses).toEqual([
      ADDR.patchSelect,
      ADDR.patchNumber,
      ...[0, 1, 2, 3, 4].map((k) => ADDR.effectStatus + k),
      ...[0, 1, 2, 3].map((k) => ADDR.effectStatus + k),
      ADDR.patchNumber,
    ]);
    expect(reports.at(-1)?.data).toEqual([0, 5]);
  });

  it('PATCH_SELECT of the active channel leaves out the last patch number', async () => {
    const { queue, reports } = await connectedMock();
    await run(queue.write(ADDR.patchSelect, u2x4.encode(1)));
    await vi.advanceTimersByTimeAsync(200);
    expect(reports).toHaveLength(11);
  });

  it('status bytes: colour of the variation, 3 when the effect is off', async () => {
    const { amp, queue, reports } = await connectedMock();
    const slot = storedPatchAddress(2);
    amp.poke(slot + addr(0, 0, 0x04, 0x00), [0, 1, 2, 2, 1]); // colours
    amp.poke(slot + addr(0, 0, 0x08, 0x00), [1, 1, 0, 1, 0, 0]); // reverb (byte 5) off
    await run(queue.write(ADDR.patchSelect, u2x4.encode(2)));
    await vi.advanceTimersByTimeAsync(200);
    const status = reports
      .filter((r) => r.address >= ADDR.effectStatus)
      .slice(0, 5)
      .map((r) => r.data[0]);
    expect(status).toEqual([0, 1, 3, 2, 3]);
  });

  it('PATCH_WRITE copies the current patch into the slot and is acknowledged', async () => {
    const { amp, queue, reports } = await connectedMock();
    await run(queue.write(GAIN, [77]));
    await run(queue.write(ADDR.patchWrite, u2x4.encode(1), { allowPatchWrite: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(amp.peek(storedPatchAddress(1) + addr(0, 0, 0x06, 0x00))).toEqual([77]);
    expect(reports[0]).toMatchObject({ address: ADDR.patchWrite, data: [0, 1] });
  });
});

describe('mock amp: reports from the amp itself', () => {
  it('reports knobs, channel changes and saving only with editor mode on', async () => {
    const { amp, queue, reports } = await connectedMock();
    amp.turnKnob(GAIN, 60);
    amp.selectChannelOnAmp(3);
    amp.saveOnAmp();
    await vi.advanceTimersByTimeAsync(300);
    expect(reports[0]).toMatchObject({ address: GAIN, data: [60] });
    expect(reports.filter((r) => r.address === ADDR.patchNumber).map((r) => r.data)).toEqual([[0, 3]]);
    expect(reports.some((r) => r.address === ADDR.patchWrite)).toBe(true);

    reports.length = 0;
    await run(queue.write(ADDR.editorMode, [0]));
    amp.turnKnob(GAIN, 61);
    amp.selectChannelOnAmp(4);
    await vi.advanceTimersByTimeAsync(300);
    expect(reports).toEqual([]);
    expect(amp.patchNumber).toBe(4); // the amp still switched
  });

  it('channel change to PANEL also reports the effect knob positions', async () => {
    const { amp, reports } = await connectedMock();
    amp.selectChannelOnAmp(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(reports.some((r) => r.address === addr(0x30, 0x00, 0x02, 0x00))).toBe(true);
  });

  it('a power cycle switches editor mode off', async () => {
    const { amp, queue } = await connectedMock();
    amp.powerCycle();
    expect(await run(queue.readBytes(ADDR.editorMode, 1))).toEqual([0]);
  });

  it('ignores messages with a bad checksum or a foreign device ID', async () => {
    const amp = new MockAmp();
    const seen: number[][] = [];
    amp.onMessage((m) => seen.push([...m]));
    const bad = buildRq1(0x10, ADDR.editorLevel, 1);
    bad[bad.length - 2] = (bad[bad.length - 2] ?? 0) ^ 1;
    await amp.send(bad);
    await amp.send(buildRq1(0x11, ADDR.editorLevel, 1));
    await amp.send(buildDt1(0x11, NS_THRESHOLD, [1]));
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual([]);
    expect(amp.peek(NS_THRESHOLD)).toEqual([40]);
  });
});
