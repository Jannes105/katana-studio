import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ADDR, IDENTITY_REQUEST, buildDt1, buildRq1, packetizeSysex, parseMessage } from '../shared/katana.js';
import {
  GuardedValue,
  KatanaLink,
  LatestValueQueue,
  PacedSender,
  analyzeRangeRead,
  checkIdentity,
  normalizeWebUsbDevice,
  parseRawDescriptors,
  pickInterface,
  readLength,
} from './usb-core.js';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// A made-up Roland-style device: audio control, audio streaming (isochronous), vendor MIDI
// interface with bulk endpoints on alt 0 and interrupt endpoints on alt 1.
const DEVICE = [0x12, 0x01, 0x00, 0x02, 0xff, 0x00, 0xff, 0x40, 0x82, 0x05, 0xf0, 0x02, 0x00, 0x01, 0x01, 0x02, 0x00, 0x01];
const CONFIG_BODY = [
  0x09, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, // interface 0, no endpoints
  0x09, 0x04, 0x01, 0x00, 0x00, 0xff, 0x02, 0x02, 0x00, // interface 1 alt 0, no endpoints
  0x09, 0x04, 0x01, 0x01, 0x01, 0xff, 0x02, 0x02, 0x00, // interface 1 alt 1
  0x07, 0x05, 0x0d, 0x05, 0x00, 0x02, 0x01, //   iso OUT
  0x09, 0x04, 0x03, 0x00, 0x02, 0xff, 0x03, 0x00, 0x00, // interface 3 alt 0
  0x06, 0x24, 0xf1, 0x02, 0x01, 0x01, //   Roland descriptor
  0x07, 0x05, 0x03, 0x02, 0x00, 0x02, 0x00, //   bulk OUT 0x03
  0x07, 0x05, 0x84, 0x02, 0x00, 0x02, 0x00, //   bulk IN 0x84
  0x09, 0x04, 0x03, 0x01, 0x02, 0xff, 0x03, 0x00, 0x00, // interface 3 alt 1
  0x07, 0x05, 0x03, 0x02, 0x00, 0x02, 0x00, //   bulk OUT 0x03
  0x07, 0x05, 0x85, 0x03, 0x40, 0x00, 0x04, //   interrupt IN 0x85
];
const CONFIG_TOTAL = 9 + CONFIG_BODY.length;
const CONFIG = [0x09, 0x02, CONFIG_TOTAL & 0xff, CONFIG_TOTAL >> 8, 0x04, 0x01, 0x00, 0xc0, 0x00, ...CONFIG_BODY];

test('parseRawDescriptors decodes device, interfaces, endpoints and the Roland descriptor', () => {
  const parsed = parseRawDescriptors([...DEVICE, ...CONFIG]);
  assert.equal(parsed.error, null);
  assert.equal(parsed.device.vendorId, 0x0582);
  assert.equal(parsed.device.productId, 0x02f0);
  assert.equal(parsed.device.deviceClass, 0xff);
  assert.equal(parsed.configurations.length, 1);
  const interfaces = parsed.configurations[0].interfaces;
  assert.equal(interfaces.length, 5);
  const midi = interfaces[3];
  assert.deepEqual([midi.id, midi.alternateSetting, midi.interfaceClass], [3, 0, 0xff]);
  assert.deepEqual(midi.endpoints, [
    { address: 0x03, number: 3, direction: 'out', type: 'bulk', maxPacketSize: 512, interval: 0 },
    { address: 0x84, number: 4, direction: 'in', type: 'bulk', maxPacketSize: 512, interval: 0 },
  ]);
  assert.equal(interfaces[4].endpoints[1].type, 'interrupt');
  assert.equal(interfaces[4].endpoints[1].maxPacketSize, 64);
  assert.equal(interfaces[2].endpoints[0].type, 'isochronous');
  assert.equal(parsed.roland.length, 1);
  assert.deepEqual([parsed.roland[0].interfaceId, parsed.roland[0].alternateSetting], [3, 0]);
  assert.equal(parsed.lines.length, 13);
  assert.ok(parsed.lines.some((l) => l.includes('ROLAND MIDI DESCRIPTOR')));
});

test('parseRawDescriptors reports truncated and malformed input without throwing', () => {
  const cut = parseRawDescriptors(CONFIG.slice(0, CONFIG.length - 3));
  assert.match(cut.error, /Malformed descriptor/);
  assert.equal(cut.configurations[0].interfaces.length, 5);
  assert.match(parseRawDescriptors([0x00, 0x01]).error, /bLength=0/);
  assert.equal(parseRawDescriptors([]).error, null);
  assert.equal(parseRawDescriptors(null).lines.length, 0);
});

test('pickInterface prefers the vendor interface with bulk/interrupt IN and OUT, lowest alt', () => {
  const interfaces = parseRawDescriptors(CONFIG).configurations[0].interfaces;
  const pick = pickInterface(interfaces);
  assert.equal(pick.interfaceId, 3);
  assert.equal(pick.alternateSetting, 0);
  assert.equal(pick.inEndpoint.address, 0x84);
  assert.equal(pick.outEndpoint.address, 0x03);
  assert.equal(pick.candidates.length, 2);
  assert.equal(pick.candidates[1].inEndpoint.address, 0x85);
});

test('pickInterface skips isochronous-only interfaces and ranks vendor class above others', () => {
  const ep = (address, type) => ({ address, number: address & 15, direction: address & 0x80 ? 'in' : 'out', type, maxPacketSize: 64 });
  const iso = { id: 0, alternateSetting: 1, interfaceClass: 0xff, endpoints: [ep(0x81, 'isochronous'), ep(0x01, 'isochronous')] };
  const cdc = { id: 1, alternateSetting: 0, interfaceClass: 0x0a, endpoints: [ep(0x82, 'bulk'), ep(0x02, 'bulk')] };
  const vendorAlt1 = { id: 2, alternateSetting: 1, interfaceClass: 0xff, endpoints: [ep(0x83, 'interrupt'), ep(0x03, 'interrupt')] };
  assert.equal(pickInterface([iso]), null);
  assert.equal(pickInterface([]), null);
  assert.equal(pickInterface(undefined), null);
  const pick = pickInterface([iso, cdc, vendorAlt1]);
  assert.deepEqual([pick.interfaceId, pick.alternateSetting], [2, 1]);
  assert.equal(pickInterface([iso, cdc]).interfaceId, 1);
});

test('normalizeWebUsbDevice flattens alternates and derives endpoint addresses', () => {
  const model = normalizeWebUsbDevice({
    vendorId: 0x0582,
    productId: 0x02f0,
    deviceClass: 0xff,
    deviceSubclass: 0,
    deviceProtocol: 0xff,
    configuration: null,
    configurations: [{
      configurationValue: 1,
      interfaces: [{
        interfaceNumber: 3,
        alternates: [
          { alternateSetting: 0, interfaceClass: 0xff, interfaceSubclass: 3, interfaceProtocol: 0, endpoints: [
            { endpointNumber: 3, direction: 'out', type: 'bulk', packetSize: 512 },
            { endpointNumber: 4, direction: 'in', type: 'bulk', packetSize: 512 },
          ] },
          { alternateSetting: 1, interfaceClass: 0xff, interfaceSubclass: 3, interfaceProtocol: 0, endpoints: [] },
        ],
      }],
    }],
  });
  assert.equal(model.interfaces.length, 2);
  assert.equal(model.interfaces[0].endpoints[1].address, 0x84);
  assert.equal(model.interfaces[0].endpoints[0].address, 0x03);
  assert.equal(pickInterface(model.interfaces).inEndpoint.number, 4);
});

test('readLength is a multiple of the packet size and at least 512', () => {
  assert.equal(readLength(64), 512);
  assert.equal(readLength(512), 4096);
  assert.equal(readLength(48), 528);
  assert.equal(readLength(0), 512);
});

test('checkIdentity verdicts', () => {
  const reply = (model, dev = 0x10) => parseMessage([0xf0, 0x7e, dev, 0x06, 0x02, 0x41, 0x07, 0x05, 0x00, 0x00, model, 0x00, 0x00, 0x00, 0xf7]);
  assert.deepEqual(
    (({ verified, exact, isKatana100 }) => ({ verified, exact, isKatana100 }))(checkIdentity(reply(0x06))),
    { verified: true, exact: true, isKatana100: true },
  );
  const otherId = checkIdentity(reply(0x06, 0x11));
  assert.equal(otherId.isKatana100, true);
  assert.equal(otherId.exact, false);
  const otherModel = checkIdentity(reply(0x05));
  assert.equal(otherModel.verified, true);
  assert.equal(otherModel.isKatana100, false);
  const foreign = checkIdentity(parseMessage([0xf0, 0x7e, 0x10, 0x06, 0x02, 0x42, 0x07, 0x05, 0, 0, 6, 0, 0, 0, 0xf7]));
  assert.equal(foreign.verified, false);
  assert.equal(checkIdentity(null).verified, false);
});

test('PacedSender keeps the gap, lets priority items overtake, and survives write errors', async () => {
  let clock = 0;
  const written = [];
  const sender = new PacedSender({
    write: async (bytes) => {
      if (bytes[0] === 99) throw new Error('boom');
      written.push({ at: clock, bytes });
    },
    interval: () => 30,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  });
  const first = sender.send([1]);
  const second = sender.send([2]);
  const urgent = sender.send([3], { priority: true });
  const failing = sender.send([99]);
  const last = sender.send(() => [4]);
  await Promise.all([first, second, urgent, last]);
  await assert.rejects(failing, /boom/);
  assert.deepEqual(written.map((w) => w.bytes[0]), [1, 3, 2, 4]);
  assert.deepEqual(written.map((w) => w.at), [0, 30, 60, 90]);
});

test('PacedSender.clear rejects everything that is still waiting', async () => {
  const written = [];
  const sender = new PacedSender({ write: async (b) => { written.push(b); }, interval: () => 20 });
  const a = sender.send([1]);
  const b = sender.send([2]);
  const outcome = b.then(() => 'sent', (e) => e.message);
  sender.clear('gone');
  await a;
  assert.equal(await outcome, 'gone');
  await tick(40);
  assert.deepEqual(written, [[1]]);
});

test('LatestValueQueue sends only the newest value per key', async () => {
  let clock = 0;
  const written = [];
  const sender = new PacedSender({ write: async (b) => { written.push(b); }, interval: () => 25, now: () => clock, sleep: async (ms) => { await tick(); clock += ms; } });
  const queue = new LatestValueQueue((source) => sender.send(source));
  const build = (key) => (value) => [key, value];
  await sender.send([0, 0]); // occupy the slot so the next writes have to wait
  for (let v = 1; v <= 10; v++) queue.set('a', v, build(1));
  queue.set('b', 50, build(2));
  queue.set('a', 11, build(1));
  queue.set('b', 51, build(2));
  assert.equal(queue.size, 2);
  await tick(30);
  assert.deepEqual(written, [[0, 0], [1, 11], [2, 51]]);
  assert.equal(queue.size, 0);

  queue.set('a', 12, build(1));
  queue.clear();
  await tick(30);
  assert.equal(written.length, 3, 'cleared value is not sent');
  queue.set('a', 13, build(1));
  await tick(30);
  assert.deepEqual(written[3], [1, 13]);
});

test('GuardedValue ignores amp reports while dragging and for 300 ms afterwards', () => {
  const g = new GuardedValue({ min: 0, max: 100, holdMs: 300 });
  assert.equal(g.userStep(5, 0), null, 'no stepping before the value was read');
  assert.equal(g.applyRemote(40, 0), true);
  g.beginDrag(1000);
  assert.equal(g.userSet(47.4, 1100), 47);
  assert.equal(g.applyRemote(10, 5000), false, 'dragging');
  g.endDrag(5000);
  assert.equal(g.applyRemote(10, 5299), false);
  assert.equal(g.value, 47);
  assert.equal(g.applyRemote(10, 5300), true);
  assert.equal(g.userStep(-50, 6000), 0, 'clamped at min');
  assert.equal(g.userStep(500, 6001), 100, 'clamped at max');
  g.invalidate();
  assert.equal(g.value, null);
});

test('analyzeRangeRead counts blocks, bytes, order and duplicates', () => {
  const blocks = [
    { linearAddress: 10, data: [1, 2, 3], at: 105 },
    { linearAddress: 30, data: [1], at: 110 },
    { linearAddress: 20, data: [1, 2], at: 120 },
    { linearAddress: 30, data: [1], at: 130 },
  ];
  assert.deepEqual(analyzeRangeRead(blocks, 100), {
    count: 4, dataBytes: 7, ascending: false, outOfOrder: 1, duplicates: 1, maxDataLength: 3, firstReplyMs: 5, totalMs: 30,
  });
  assert.equal(analyzeRangeRead([], 0).totalMs, null);
  assert.equal(analyzeRangeRead(blocks.slice(0, 2), 100).ascending, true);
});

// ---- KatanaLink against a fake amp ----

function makeLink(reply) {
  const sent = [];
  const logs = [];
  const link = new KatanaLink({
    interval: () => 0,
    log: (cls, text) => logs.push(`${cls}: ${text}`),
    write: async (packets, message) => {
      sent.push({ packets: Array.from(packets), message });
      const answers = reply ? reply(message) : [];
      // Reply before the write promise resolves, like a fast amp behind a slow bridge.
      for (const a of answers) link.feed(packetizeSysex(a.message, a.cable ?? 0));
    },
  });
  return { link, sent, logs };
}
const IDENTITY_REPLY = [0xf0, 0x7e, 0x10, 0x06, 0x02, 0x41, 0x07, 0x05, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0xf7];

test('KatanaLink.identity sends USB-MIDI packets on the chosen cable and reports the replying cable', async () => {
  const { link, sent } = makeLink(() => [{ message: IDENTITY_REPLY, cable: 2 }]);
  link.setCable(5);
  const reply = await link.identity({ timeoutMs: 50 });
  assert.deepEqual(sent[0].packets, [0x54, 0xf0, 0x7e, 0x7f, 0x57, 0x06, 0x01, 0xf7]);
  assert.deepEqual(sent[0].message, Array.from(IDENTITY_REQUEST));
  assert.equal(reply.cable, 2);
  assert.equal(reply.message.modelCode, 0x06);
});

test('KatanaLink.identity rejects after the timeout', async () => {
  const { link } = makeLink();
  await assert.rejects(link.identity({ timeoutMs: 20 }), /No identity reply within 20 ms/);
  assert.equal(link.pending, null);
});

test('KatanaLink.request matches the reply by address and reports other DT1 as unsolicited', async () => {
  const other = buildDt1(0x10, [0x20, 0x00, 0x06, 0x00], [50, 60]);
  const answer = buildDt1(0x10, ADDR.editorLevel, [1]);
  const { link, sent } = makeLink(() => [{ message: other }, { message: answer }]);
  const seen = [];
  link.onDt1 = (msg, info) => seen.push([msg.address.join(','), info.solicited]);
  const r = await link.request(ADDR.editorLevel, 1, { timeoutMs: 50 });
  assert.deepEqual(r.data, [1]);
  assert.deepEqual(sent[0].message, buildRq1(0x10, ADDR.editorLevel, 1));
  assert.deepEqual(seen, [['32,0,6,0', false], ['127,0,0,0', true]]);
});

test('KatanaLink runs only one request at a time and times out per request', async () => {
  let outstanding = 0;
  let maxOutstanding = 0;
  let link;
  const sent = [];
  link = new KatanaLink({
    interval: () => 0,
    write: async (packets, message) => {
      sent.push(message);
      if (message[10] === 0x01) return; // never answer the second address
      outstanding++;
      maxOutstanding = Math.max(maxOutstanding, outstanding);
      setTimeout(() => {
        outstanding--;
        link.feed(packetizeSysex(buildDt1(0x10, message.slice(7, 11), [7]), 0));
      }, 10);
    },
  });
  const a = link.request([0x20, 0x00, 0x00, 0x00], 1, { timeoutMs: 40 });
  const b = link.request([0x20, 0x00, 0x00, 0x01], 1, { timeoutMs: 40 });
  const c = link.request([0x20, 0x00, 0x00, 0x02], 1, { timeoutMs: 40 });
  assert.deepEqual((await a).data, [7]);
  assert.ok(sent.length <= 2, 'third request is not sent while the second is outstanding');
  await assert.rejects(b, /No reply within 40 ms for RQ1 20 00 00 01/);
  assert.deepEqual((await c).data, [7]);
  assert.equal(maxOutstanding, 1);
  assert.equal(sent.length, 3);
});

test('KatanaLink range request collects all blocks until silence, split across transfers', async () => {
  const blocks = [
    buildDt1(0x10, [0x20, 0x00, 0x00, 0x00], [1, 2, 3]),
    buildDt1(0x10, [0x20, 0x00, 0x10, 0x00], [4]),
    buildDt1(0x10, [0x20, 0x00, 0x06, 0x00], [5, 6]),
  ];
  const outside = buildDt1(0x10, [0x00, 0x00, 0x00, 0x00], [0, 8]);
  let link;
  link = new KatanaLink({
    interval: () => 0,
    write: async () => {
      const stream = [...blocks, outside].flatMap((m) => Array.from(packetizeSysex(m, 0)));
      setTimeout(() => link.feed(stream.slice(0, 20)), 5);
      setTimeout(() => link.feed(stream.slice(20)), 15);
    },
  });
  const unsolicited = [];
  link.onDt1 = (msg, info) => { if (!info.solicited) unsolicited.push(msg.address); };
  const r = await link.request([0x20, 0x00, 0x00, 0x00], [0x00, 0x02, 0x00, 0x00], { range: true, timeoutMs: 100, quietMs: 40 });
  assert.equal(r.blocks.length, 3);
  const a = analyzeRangeRead(r.blocks, r.sentAt);
  assert.equal(a.dataBytes, 6);
  assert.equal(a.ascending, false);
  assert.deepEqual(unsolicited, [[0, 0, 0, 0]]);
});

test('KatanaLink.writeLatest sends the newest value and reset() rejects a pending request', async () => {
  const { link, sent } = makeLink();
  const address = [0x20, 0x00, 0x58, 0x01];
  link.sender.nextAt = link.now() + 15; // slot busy: writes have to wait
  for (const v of [10, 11, 12]) link.writeLatest(address, [v], 'NS');
  await tick(40);
  assert.deepEqual(sent.map((s) => s.message), [buildDt1(0x10, address, [12])]);

  const pending = link.request(ADDR.editorLevel, 1, { timeoutMs: 500 });
  const outcome = pending.then(() => 'ok', (e) => e.message);
  await tick(5);
  link.reset('unplugged');
  assert.equal(await outcome, 'unplugged');
});

test('KatanaLink ignores DT1 with a bad checksum', async () => {
  const bad = buildDt1(0x10, ADDR.editorLevel, [1]);
  bad[bad.length - 2] ^= 0x01;
  const { link, logs } = makeLink(() => [{ message: bad }]);
  await assert.rejects(link.request(ADDR.editorLevel, 1, { timeoutMs: 20 }), /No reply/);
  assert.ok(logs.some((l) => l.includes('BAD CHECKSUM')));
});
