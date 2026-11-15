import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADDR, SIZE, addOffset, buildDt1, hex, parseMessage } from '../shared/katana.js';
import { RequestManager, formatResult } from './requests.js';

// Fake clock with timers, so the tests run without waiting.
function makeHarness(options = {}) {
  let clock = 0;
  let nextId = 1;
  const timers = new Map();
  const sent = [];
  const manager = new RequestManager({
    send: (bytes) => { sent.push(bytes); },
    getDeviceId: () => 0x10,
    now: () => clock,
    setTimer: (fn, ms) => { timers.set(nextId, { at: clock + ms, fn }); return nextId++; },
    clearTimer: (id) => { timers.delete(id); },
    ...options,
  });
  const advance = (ms) => {
    const target = clock + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].fn();
    }
    clock = target;
  };
  const dt1 = (address, data) => manager.handleDt1(parseMessage(buildDt1(0x10, address, data)), clock);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { manager, sent, advance, dt1, settle };
}

test('small request: sends RQ1 and finishes as soon as the reply covers it', async () => {
  const h = makeHarness();
  const promise = h.manager.request(ADDR.editorLevel, 1, { label: 'editor level' });
  await h.settle();
  assert.equal(hex(h.sent[0]), 'F0 41 10 01 05 07 11 7F 00 00 00 00 00 00 01 00 F7');
  h.advance(4);
  assert.equal(h.dt1(ADDR.editorLevel, [0x01]), true);
  const result = await promise;
  assert.equal(result.timedOut, false);
  assert.equal(result.dt1Count, 1);
  assert.equal(result.dataBytes, 1);
  assert.equal(result.firstReplyMs, 4);
  assert.equal(result.durationMs, 4);
  assert.equal(h.manager.busy, false);
});

test('times out after 1.5 s without a reply', async () => {
  const h = makeHarness();
  const promise = h.manager.request([0x21, 0x30, 0x00, 0x00], 16);
  await h.settle();
  h.advance(1499);
  assert.equal(h.manager.busy, true);
  h.advance(1);
  const result = await promise;
  assert.equal(result.timedOut, true);
  assert.equal(result.dt1Count, 0);
  assert.match(formatResult(result), /NO REPLY/);
});

test('range request: matched by address, done after the silence gap, order reported', async () => {
  const h = makeHarness();
  const promise = h.manager.request(ADDR.currentPatch, SIZE.patch, { label: 'patch' });
  await h.settle();
  h.advance(3);
  assert.equal(h.dt1(ADDR.currentPatch, new Array(16).fill(0x20)), true);
  h.advance(3);
  assert.equal(h.dt1(addOffset(ADDR.currentPatch, 0x58 * 128), [1, 30, 40]), true);
  h.advance(3);
  // outside the requested range: unsolicited, does not extend the request
  assert.equal(h.dt1(ADDR.patchNumber, [0, 8]), false);
  // lower address after a higher one: the amp does not deliver strictly ascending
  assert.equal(h.dt1(addOffset(ADDR.currentPatch, 0x06 * 128), [50, 60]), true);
  h.advance(299);
  assert.equal(h.manager.busy, true);
  h.advance(1);
  const result = await promise;
  assert.equal(result.dt1Count, 3);
  assert.equal(result.dataBytes, 21);
  assert.equal(result.firstReplyMs, 3);
  assert.equal(result.durationMs, 9);
  assert.equal(result.ascending, false);
  assert.equal(result.outOfOrder, 1);
  assert.equal(result.firstOutOfOrder.address, '20 00 06 00');
  assert.deepEqual(result.duplicates, []);
  assert.match(formatResult(result), /3 DT1, 21 data bytes.*NOT ascending/);
});

test('size is converted from 7-bit notation: the range end is exclusive', async () => {
  const h = makeHarness();
  const promise = h.manager.request(ADDR.currentPatch, SIZE.patch);
  await h.settle();
  assert.equal(h.dt1([0x20, 0x01, 0x7f, 0x7f], [1]), true); // last address inside 00 02 00 00
  assert.equal(h.dt1([0x20, 0x02, 0x00, 0x00], [1]), false); // first address behind it
  h.advance(300);
  assert.equal((await promise).dt1Count, 1);
});

test('a block arriving twice is listed as duplicate', async () => {
  const h = makeHarness();
  const promise = h.manager.request(ADDR.currentPatch, SIZE.patch);
  await h.settle();
  h.dt1(ADDR.currentPatch, new Array(16).fill(0x41));
  h.dt1(ADDR.currentPatch, new Array(16).fill(0x41));
  h.advance(300);
  const result = await promise;
  assert.deepEqual(result.duplicates, ['20 00 00 00']);
});

test('only one RQ1 is outstanding; the next one waits', async () => {
  const h = makeHarness();
  const first = h.manager.request(ADDR.editorLevel, 1);
  const second = h.manager.request(ADDR.patchNumber, 2);
  await h.settle();
  assert.equal(h.sent.length, 1);
  // a DT1 for the queued request is not a reply yet
  assert.equal(h.dt1(ADDR.patchNumber, [0, 8]), false);
  h.dt1(ADDR.editorLevel, [1]);
  await first;
  await h.settle();
  assert.equal(h.sent.length, 2);
  assert.equal(h.dt1(ADDR.patchNumber, [0, 8]), true);
  assert.deepEqual((await second).blocks[0].data, [0, 8]);
});

test('no DT1 counts as reply while nothing is outstanding', () => {
  const h = makeHarness();
  assert.equal(h.dt1(ADDR.currentPatch, [1]), false);
});

test('send time reported by send() is used for the timing', async () => {
  const h = makeHarness({ send: () => Promise.resolve(40) });
  const promise = h.manager.request(ADDR.editorLevel, 1);
  await h.settle();
  h.advance(45);
  h.dt1(ADDR.editorLevel, [1]);
  assert.equal((await promise).firstReplyMs, 5);
});

test('send failure rejects and frees the slot; cancelAll rejects everything', async () => {
  let fail = true;
  const h = makeHarness({ send: () => { if (fail) throw new Error('Not connected'); } });
  await assert.rejects(h.manager.request(ADDR.editorLevel, 1), /Not connected/);
  assert.equal(h.manager.busy, false);
  fail = false;
  const a = h.manager.request(ADDR.editorLevel, 1);
  const b = h.manager.request(ADDR.patchNumber, 2);
  await h.settle();
  h.manager.cancelAll('Port disconnected');
  await assert.rejects(a, /Port disconnected/);
  await assert.rejects(b, /Port disconnected/);
  assert.equal(h.manager.busy, false);
});
