import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageListener, MidiMessage, Transport } from '../../src/midi/transport';
import { ADDR, SIZE, addr, formatAddress, storedPatchAddress } from '../../src/protocol/address';
import { PATCH_BLOCKS } from '../../src/protocol/blocks';
import { greet } from '../../src/protocol/greeting';
import {
  QueueCancelledError,
  QueueClosedError,
  QueueTimeoutError,
  SendQueue,
  WriteBlockedError,
  type Diagnostic,
} from '../../src/protocol/queue';
import { buildDt1, parseHex, parseMessage, type ParsedMessage } from '../../src/protocol/sysex';

const DEV = 0x10;
const IDENTITY_REPLY = parseHex('F0 7E 10 06 02 41 07 05 00 00 06 00 00 00 F7');
const NS_THRESHOLD = addr(0x20, 0x00, 0x58, 0x01);
const GAIN = addr(0x20, 0x00, 0x06, 0x00);

/** Records what the queue sends. `hold()` makes the next sends wait until `release()`. */
class FakeTransport implements Transport {
  readonly sent: { at: number; message: MidiMessage }[] = [];
  private listener: MessageListener | undefined;
  private holding = false;
  private waiting: (() => void)[] = [];
  failNext = false;

  send(message: MidiMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('USB gone'));
    }
    this.sent.push({ at: Date.now(), message });
    if (!this.holding) return Promise.resolve();
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  onMessage(listener: MessageListener): () => void {
    this.listener = listener;
    return () => (this.listener = undefined);
  }

  receive(message: MidiMessage): void {
    this.listener?.(message);
  }

  hold(): void {
    this.holding = true;
  }

  release(): void {
    this.holding = false;
    for (const w of this.waiting.splice(0)) w();
  }

  /** Sent messages, described briefly: "ID", "RQ1 20 00 00 00", "DT1 20 00 58 01 = 40". */
  log(): string[] {
    return this.sent.map(({ message }) => {
      const m = parseMessage(message);
      if (m.type === 'rq1') return `RQ1 ${formatAddress(m.address)}`;
      if (m.type === 'dt1') return `DT1 ${formatAddress(m.address)} = ${m.data.join(' ')}`;
      return 'ID';
    });
  }
}

/** Lets pending promises and timers run. */
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

async function connected(options = {}) {
  const transport = new FakeTransport();
  const queue = new SendQueue(transport, options);
  const id = queue.identify();
  await tick();
  transport.receive(IDENTITY_REPLY);
  await id;
  transport.sent.length = 0;
  return { transport, queue };
}

/** Answers a whole-patch read at `base` with one DT1 per block, in the given order. */
function patchReply(base: number, order: (i: number) => number = (i) => i): MidiMessage[] {
  return PATCH_BLOCKS.map((_, i) => {
    const b = PATCH_BLOCKS[order(i)];
    if (!b) throw new Error('bad order');
    return buildDt1(
      DEV,
      base + b.offset,
      Array.from({ length: b.length }, () => 1),
    );
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('identify', () => {
  it('sends the broadcast identity request and learns the device ID', async () => {
    const transport = new FakeTransport();
    const queue = new SendQueue(transport);
    expect(queue.deviceId).toBeUndefined();
    const id = queue.identify();
    await tick();
    expect(transport.log()).toEqual(['ID']);
    transport.receive(IDENTITY_REPLY);
    await expect(id).resolves.toMatchObject({ deviceId: 0x10, modelCode: 0x06 });
    expect(queue.deviceId).toBe(0x10);
  });

  it('refuses reads and writes before identify', async () => {
    const queue = new SendQueue(new FakeTransport());
    await expect(queue.read(ADDR.editorLevel, 1)).rejects.toThrow('Not identified');
    await expect(queue.write(NS_THRESHOLD, [40])).rejects.toThrow('Not identified');
  });
});

describe('reads (rule 4)', () => {
  it('a single read completes with the first DT1 at its address', async () => {
    const { transport, queue } = await connected();
    const read = queue.readBytes(ADDR.editorLevel, 1);
    await tick();
    expect(transport.log()).toEqual(['RQ1 7F 00 00 00']);
    transport.receive(buildDt1(DEV, ADDR.editorMode, [1])); // other address: not the reply
    transport.receive(buildDt1(DEV, ADDR.editorLevel, [1]));
    await expect(read).resolves.toEqual([1]);
  });

  it('a whole patch completes when all 80 blocks are there, in any order', async () => {
    const { transport, queue } = await connected();
    let done = false;
    const read = queue.read(ADDR.currentPatch, SIZE.patch).then((r) => ((done = true), r));
    await tick();
    const replies = patchReply(ADDR.currentPatch, (i) => 79 - i); // reversed
    for (const r of replies.slice(0, 79)) transport.receive(r);
    await tick();
    expect(done).toBe(false);
    transport.receive(replies[79] ?? []);
    const reply = await read;
    expect(reply.blocks.size).toBe(80);
  });

  it('a report inside the range counts as a reply; the newest value wins', async () => {
    const { transport, queue } = await connected();
    const read = queue.read(ADDR.currentPatch, SIZE.patch);
    await tick();
    const replies = patchReply(ADDR.currentPatch);
    for (const r of replies.slice(0, 3)) transport.receive(r);
    // The amp reports a knob at the amp block start (03 = amp block) in the middle of the reply.
    transport.receive(buildDt1(DEV, ADDR.currentPatch + addr(0, 0, 0x06, 0), [55]));
    for (const r of replies.slice(3)) transport.receive(r); // the real amp block arrives later
    const reply = await read;
    expect(reply.blocks.get(ADDR.currentPatch + addr(0, 0, 0x06, 0))).toHaveLength(10);
  });

  it('only one request is open at a time; the next goes out after the first completes', async () => {
    const { transport, queue } = await connected();
    const a = queue.readBytes(ADDR.editorLevel, 1);
    const b = queue.readBytes(ADDR.editorMode, 1);
    await tick();
    expect(transport.log()).toEqual(['RQ1 7F 00 00 00']);
    transport.receive(buildDt1(DEV, ADDR.editorLevel, [1]));
    await a;
    await tick();
    expect(transport.log()).toEqual(['RQ1 7F 00 00 00', 'RQ1 7F 00 00 01']);
    transport.receive(buildDt1(DEV, ADDR.editorMode, [1]));
    await expect(b).resolves.toEqual([1]);
  });
});

describe('writes (rules 1–3)', () => {
  it('a DT1 does not wait for an open RQ1', async () => {
    const { transport, queue } = await connected();
    void queue.read(ADDR.currentPatch, SIZE.patch);
    await tick();
    await queue.write(NS_THRESHOLD, [40]);
    expect(transport.log()).toEqual(['RQ1 20 00 00 00', 'DT1 20 00 58 01 = 40']);
  });

  it('a waiting DT1 is replaced by a newer value for the same address', async () => {
    const { transport, queue } = await connected();
    transport.hold();
    const first = queue.write(GAIN, [10]); // in flight
    await tick();
    const writes = [41, 42, 43].map((v) => queue.write(NS_THRESHOLD, [v]));
    transport.release();
    await Promise.all([first, ...writes]);
    expect(transport.log()).toEqual(['DT1 20 00 06 00 = 10', 'DT1 20 00 58 01 = 43']);
  });

  it('a waiting value is not replaced past a later whole block that covers it (the order stays)', async () => {
    const { transport, queue } = await connected();
    const nsBlock = addr(0x20, 0x00, 0x58, 0x00);
    transport.hold();
    const first = queue.write(GAIN, [10]); // in flight
    await tick();
    const w = [
      queue.write(NS_THRESHOLD, [41]),
      queue.write(nsBlock, [1, 50, 30]),
      queue.write(NS_THRESHOLD, [42]),
    ];
    transport.release();
    await Promise.all([first, ...w]);
    expect(transport.log()).toEqual([
      'DT1 20 00 06 00 = 10',
      'DT1 20 00 58 01 = 41',
      'DT1 20 00 58 00 = 1 50 30',
      'DT1 20 00 58 01 = 42',
    ]);
  });

  it('writes of different length or address are not merged', async () => {
    const { transport, queue } = await connected();
    transport.hold();
    const first = queue.write(GAIN, [10]);
    await tick();
    const w = [queue.write(GAIN, [11, 12]), queue.write(GAIN, [13]), queue.write(NS_THRESHOLD, [40])];
    transport.release();
    await Promise.all([first, ...w]);
    expect(transport.log()).toEqual([
      'DT1 20 00 06 00 = 10',
      'DT1 20 00 06 00 = 11 12',
      'DT1 20 00 06 00 = 13',
      'DT1 20 00 58 01 = 40',
    ]);
  });

  it('small messages go out without a gap', async () => {
    const { transport, queue } = await connected();
    await Promise.all([queue.write(GAIN, [1]), queue.write(NS_THRESHOLD, [2]), queue.write(GAIN, [3, 4])]);
    expect(transport.sent.map((s) => s.at)).toEqual([0, 0, 0].map(() => transport.sent[0]?.at));
  });

  it('whole blocks go out without a gap too (protocol-notes 2.13, measured 2026-11-17)', async () => {
    const { transport, queue } = await connected();
    const block = addr(0x20, 0x00, 0x1c, 0x00);
    await Promise.all([
      queue.write(
        block,
        Array.from({ length: 225 }, () => 1),
      ),
      queue.write(GAIN, [2]),
    ]);
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1]?.at).toBe(transport.sent[0]?.at);
  });
});

describe('timeouts (rule 5)', () => {
  it('no reply: one retry after 500 ms, then QueueTimeoutError; the next request goes on', async () => {
    const diagnostics: Diagnostic[] = [];
    const { transport, queue } = await connected({ onDiagnostic: (d: Diagnostic) => diagnostics.push(d) });
    const read = queue.readBytes(ADDR.editorLevel, 1);
    const failed = expect(read).rejects.toBeInstanceOf(QueueTimeoutError);
    const next = queue.readBytes(ADDR.editorMode, 1);
    await tick(499);
    expect(transport.log()).toEqual(['RQ1 7F 00 00 00']);
    await tick(1);
    expect(transport.log()).toEqual(['RQ1 7F 00 00 00', 'RQ1 7F 00 00 00']);
    expect(diagnostics.map((d) => d.kind)).toEqual(['retry']);
    await tick(500);
    await failed;
    await tick();
    expect(transport.log().at(-1)).toBe('RQ1 7F 00 00 01');
    transport.receive(buildDt1(DEV, ADDR.editorMode, [1]));
    await expect(next).resolves.toEqual([1]);
  });

  it('progress keeps a long read alive', async () => {
    const { transport, queue } = await connected();
    const read = queue.read(ADDR.currentPatch, SIZE.patch);
    await tick();
    for (const r of patchReply(ADDR.currentPatch)) {
      await tick(400); // slower than the timeout in total, but never 500 ms without progress
      transport.receive(r);
    }
    await expect(read).resolves.toMatchObject({ address: ADDR.currentPatch });
    expect(transport.log()).toEqual(['RQ1 20 00 00 00']);
  });

  it('a retry keeps the blocks already received', async () => {
    const { transport, queue } = await connected();
    const read = queue.read(ADDR.currentPatch, SIZE.patch);
    await tick();
    const replies = patchReply(ADDR.currentPatch);
    for (const r of replies.slice(0, 40)) transport.receive(r);
    await tick(500); // stalls: retry
    expect(transport.log()).toEqual(['RQ1 20 00 00 00', 'RQ1 20 00 00 00']);
    for (const r of replies.slice(40)) transport.receive(r);
    await expect(read).resolves.toMatchObject({ blocks: expect.any(Map) as unknown });
  });
});

describe('clear and close (rule 6)', () => {
  it('clear drops waiting messages and cancels the open request; late replies are plain reports', async () => {
    const { transport, queue } = await connected();
    const seen: ParsedMessage[] = [];
    queue.onMessage((m) => seen.push(m));
    transport.hold();
    const inFlight = queue.write(GAIN, [1]);
    await tick();
    const waitingWrite = queue.write(NS_THRESHOLD, [40]);
    const waitingRead = queue.read(ADDR.currentPatch, SIZE.patch);
    queue.clear();
    await expect(waitingWrite).rejects.toBeInstanceOf(QueueCancelledError);
    await expect(waitingRead).rejects.toBeInstanceOf(QueueCancelledError);
    transport.release();
    await inFlight; // a send already in flight completes
    expect(transport.log()).toEqual(['DT1 20 00 06 00 = 1']);

    const open = queue.readBytes(ADDR.editorLevel, 1);
    await tick();
    queue.clear();
    await expect(open).rejects.toBeInstanceOf(QueueCancelledError);
    transport.receive(buildDt1(DEV, ADDR.editorLevel, [1]));
    expect(seen.at(-1)).toMatchObject({ type: 'dt1', address: ADDR.editorLevel });
  });

  it('close rejects everything and refuses further calls', async () => {
    const { transport, queue } = await connected();
    const open = queue.readBytes(ADDR.editorLevel, 1);
    await tick();
    queue.close('USB detached');
    await expect(open).rejects.toBeInstanceOf(QueueClosedError);
    await expect(queue.write(GAIN, [1])).rejects.toBeInstanceOf(QueueClosedError);
    await expect(queue.identify()).rejects.toBeInstanceOf(QueueClosedError);
    expect(transport.log()).toEqual(['RQ1 7F 00 00 00']);
  });

  it('a failed send rejects that call and the queue goes on', async () => {
    const { transport, queue } = await connected();
    transport.failNext = true;
    await expect(queue.write(GAIN, [1])).rejects.toThrow('USB gone');
    await queue.write(GAIN, [2]);
    expect(transport.log()).toEqual(['DT1 20 00 06 00 = 2']);
  });
});

describe('incoming messages (rule 7)', () => {
  it('passes replies and reports to the listeners', async () => {
    const { transport, queue } = await connected();
    const seen: ParsedMessage[] = [];
    queue.onMessage((m) => seen.push(m));
    transport.receive(buildDt1(DEV, ADDR.patchNumber, [0, 3])); // channel change on the amp
    transport.receive(buildDt1(0x7f, GAIN, [50])); // broadcast ID is accepted
    expect(seen.map((m) => m.type)).toEqual(['dt1', 'dt1']);
  });

  it('ignores a bad checksum and a foreign device ID, also for completion', async () => {
    const diagnostics: Diagnostic[] = [];
    const { transport, queue } = await connected({ onDiagnostic: (d: Diagnostic) => diagnostics.push(d) });
    const seen: ParsedMessage[] = [];
    queue.onMessage((m) => seen.push(m));
    let done = false;
    const read = queue.readBytes(ADDR.editorLevel, 1).then((r) => ((done = true), r));
    await tick();
    const broken = buildDt1(DEV, ADDR.editorLevel, [1]);
    broken[broken.length - 2] = (broken[broken.length - 2] ?? 0) ^ 1;
    transport.receive(broken);
    transport.receive(buildDt1(0x11, ADDR.editorLevel, [1]));
    await tick();
    expect(done).toBe(false);
    expect(seen).toEqual([]);
    expect(diagnostics.map((d) => d.kind)).toEqual(['bad-checksum', 'foreign-device']);
    transport.receive(buildDt1(DEV, ADDR.editorLevel, [1]));
    await read;
  });
});

describe('safety net (rule 8)', () => {
  it('refuses DT1 into the stored slots, PREVIEW included', async () => {
    const { transport, queue } = await connected();
    for (const index of [0, 1, 8, 9]) {
      const a = storedPatchAddress(index) + addr(0, 0, 0x58, 0x01);
      await expect(queue.write(a, [40])).rejects.toBeInstanceOf(WriteBlockedError);
    }
    // A write that only starts before the slots but reaches into them is refused too.
    await expect(queue.write(ADDR.storedPatchBase - 1, [1, 2])).rejects.toBeInstanceOf(WriteBlockedError);
    expect(transport.sent).toEqual([]);
    await queue.write(storedPatchAddress(1), [65], { allowStoredSlots: true });
    expect(transport.sent).toHaveLength(1);
  });

  it('sends PATCH_WRITE only when explicitly allowed', async () => {
    const { transport, queue } = await connected();
    await expect(queue.write(ADDR.patchWrite, [0, 1])).rejects.toBeInstanceOf(WriteBlockedError);
    expect(transport.sent).toEqual([]);
    await queue.write(ADDR.patchWrite, [0, 1], { allowPatchWrite: true });
    expect(transport.log()).toEqual(['DT1 7F 00 01 04 = 0 1']);
  });

  it('never sends PATCH_WRITE onto the Panel or PREVIEW, even when allowed', async () => {
    const { transport, queue } = await connected();
    for (const data of [[0, 0], [0, 9], [0, 8, 0], [1]]) {
      await expect(queue.write(ADDR.patchWrite, data, { allowPatchWrite: true })).rejects.toBeInstanceOf(
        WriteBlockedError,
      );
    }
    expect(transport.sent).toEqual([]);
    await queue.write(ADDR.patchWrite, [0, 8], { allowPatchWrite: true });
    expect(transport.log()).toEqual(['DT1 7F 00 01 04 = 0 8']);
  });

  it('lets the current patch and the command area through', async () => {
    const { queue } = await connected();
    await queue.write(NS_THRESHOLD, [40]);
    await queue.write(ADDR.editorMode, [1]);
    await queue.write(ADDR.patchSelect, [0, 1]);
  });
});

describe('greeting over the queue', () => {
  it('runs the whole greeting against a scripted amp', async () => {
    const transport = new FakeTransport();
    const queue = new SendQueue(transport);
    let editorMode = 0;
    // A minimal amp: answers what the greeting asks.
    const answer = () => {
      for (const { message } of transport.sent.splice(0)) {
        const m = parseMessage(message);
        if (m.type === 'sysex-other') transport.receive(IDENTITY_REPLY);
        if (m.type === 'dt1' && m.address === ADDR.editorMode) editorMode = m.data[0] ?? 0;
        if (m.type === 'rq1' && m.address === ADDR.editorLevel)
          transport.receive(buildDt1(DEV, m.address, [1]));
        if (m.type === 'rq1' && m.address === ADDR.editorMode)
          transport.receive(buildDt1(DEV, m.address, [editorMode]));
      }
    };
    const result = greet(queue);
    for (let i = 0; i < 10; i++) {
      await tick();
      answer();
    }
    await expect(result).resolves.toMatchObject({ deviceId: 0x10, editorMode: 1, warnings: [] });
  });
});
