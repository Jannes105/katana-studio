// RQ1 request helper: only one request is outstanding at a time, replies are matched by address
// (not by order), and a range request is finished after a silence gap because the amp sends no
// end marker. No DOM access; timers and the clock are injected for tests.

import { buildRq1, hex, toLinear } from '../shared/katana.js';

export const DEFAULT_FIRST_REPLY_TIMEOUT_MS = 1500;
export const DEFAULT_SILENCE_GAP_MS = 300;

export class RequestManager {
  // send(bytes): sends one message, may return a promise; if it resolves to a number, that is
  //   taken as the send time (same clock as now()).
  // getDeviceId(): device ID for the Roland header.
  // now(): milliseconds, same clock as the t passed to handleDt1.
  constructor({
    send,
    getDeviceId,
    now,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    firstReplyTimeoutMs = DEFAULT_FIRST_REPLY_TIMEOUT_MS,
    silenceGapMs = DEFAULT_SILENCE_GAP_MS,
  }) {
    this.send = send;
    this.getDeviceId = getDeviceId;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.firstReplyTimeoutMs = firstReplyTimeoutMs;
    this.silenceGapMs = silenceGapMs;
    this.queue = [];
    this.current = null;
  }

  get busy() {
    return this.current !== null;
  }

  // address: 4 bytes (7-bit notation). size: 4 bytes (7-bit notation) or a linear number.
  // Resolves with a result object (see buildResult); a missing reply gives timedOut = true.
  // Rejects only if sending fails or the request is cancelled.
  request(address, size, { label = '', silenceGapMs } = {}) {
    const sizeLinear = typeof size === 'number' ? size : toLinear(size);
    if (sizeLinear < 1) throw new Error('Size must be at least 1');
    const start = toLinear(address);
    return new Promise((resolve, reject) => {
      this.queue.push({
        label,
        address: Array.from(address),
        size,
        sizeLinear,
        start,
        end: start + sizeLinear,
        silenceGapMs: silenceGapMs ?? this.silenceGapMs,
        blocks: [],
        sentAt: null,
        timer: null,
        resolve,
        reject,
      });
      this.pump();
    });
  }

  pump() {
    if (this.current || this.queue.length === 0) return;
    const entry = this.queue.shift();
    this.current = entry;
    let message;
    try {
      message = buildRq1(this.getDeviceId(), entry.address, entry.size);
    } catch (error) {
      this.fail(entry, error);
      return;
    }
    Promise.resolve()
      .then(() => this.send(message))
      .then((sentAt) => {
        if (this.current !== entry) return; // cancelled meanwhile
        entry.sentAt = typeof sentAt === 'number' ? sentAt : this.now();
        entry.timer = this.setTimer(() => this.finish(entry, true), this.firstReplyTimeoutMs);
      })
      .catch((error) => this.fail(entry, error));
  }

  // Feed every incoming DT1 (as returned by parseMessage) with its receive time.
  // Returns true if it was counted as a reply to the outstanding RQ1, false if unsolicited.
  // Note: an unsolicited DT1 whose address lies inside the requested range cannot be told apart
  // from a reply; it shows up in result.duplicates if the same address arrives twice.
  handleDt1(parsed, t) {
    const entry = this.current;
    if (!entry || entry.sentAt === null) return false;
    const lin = parsed.linearAddress;
    if (lin < entry.start || lin >= entry.end) return false;

    entry.blocks.push({
      address: parsed.address,
      linearAddress: lin,
      data: parsed.data,
      checksumOk: parsed.checksumOk,
      t,
    });
    this.clearTimer(entry.timer);
    const coversWholeRequest = lin === entry.start && parsed.data.length >= entry.sizeLinear;
    if (coversWholeRequest) this.finish(entry, false);
    else entry.timer = this.setTimer(() => this.finish(entry, false), entry.silenceGapMs);
    return true;
  }

  finish(entry, timedOut) {
    if (this.current !== entry) return;
    this.clearTimer(entry.timer);
    this.current = null;
    entry.resolve(buildResult(entry, timedOut));
    this.pump();
  }

  fail(entry, error) {
    if (this.current !== entry) return;
    this.clearTimer(entry.timer);
    this.current = null;
    entry.reject(error);
    this.pump();
  }

  // Drops the outstanding request and everything queued (e.g. on disconnect).
  cancelAll(reason = 'Cancelled') {
    const waiting = this.queue.splice(0);
    const entry = this.current;
    if (entry) {
      this.clearTimer(entry.timer);
      this.current = null;
      entry.reject(new Error(reason));
    }
    for (const w of waiting) w.reject(new Error(reason));
  }
}

export function buildResult(entry, timedOut) {
  const blocks = entry.blocks;
  const seen = new Set();
  const duplicates = [];
  let outOfOrder = 0;
  let firstOutOfOrder = null;
  let dataBytes = 0;
  let checksumErrors = 0;

  blocks.forEach((block, i) => {
    dataBytes += block.data.length;
    if (!block.checksumOk) checksumErrors++;
    if (seen.has(block.linearAddress)) duplicates.push(hex(block.address));
    seen.add(block.linearAddress);
    if (i > 0 && block.linearAddress <= blocks[i - 1].linearAddress) {
      outOfOrder++;
      firstOutOfOrder ??= { index: i, address: hex(block.address), previous: hex(blocks[i - 1].address) };
    }
  });

  const round = (ms) => Math.round(ms * 1000) / 1000;
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  return {
    label: entry.label,
    address: entry.address,
    sizeLinear: entry.sizeLinear,
    timedOut,
    blocks,
    dt1Count: blocks.length,
    dataBytes,
    sentAt: entry.sentAt,
    firstReplyMs: first ? round(first.t - entry.sentAt) : null,
    durationMs: last ? round(last.t - entry.sentAt) : null, // send until the last DT1, without the silence gap
    ascending: outOfOrder === 0,
    outOfOrder,
    firstOutOfOrder,
    duplicates,
    checksumErrors,
  };
}

export function formatResult(result) {
  const head = `${result.label || 'RQ1'} @ ${hex(result.address)}, size ${result.sizeLinear}`;
  if (result.timedOut) return `${head}: NO REPLY (timeout)`;
  const parts = [
    `${result.dt1Count} DT1`,
    `${result.dataBytes} data bytes`,
    `first reply after ${result.firstReplyMs} ms`,
    `duration ${result.durationMs} ms`,
  ];
  if (result.dt1Count > 1) {
    parts.push(result.ascending
      ? 'addresses ascending'
      : `addresses NOT ascending (${result.outOfOrder} out of order, first: ${result.firstOutOfOrder.address} after ${result.firstOutOfOrder.previous})`);
  }
  if (result.duplicates.length) parts.push(`${result.duplicates.length} duplicate address(es): ${result.duplicates.join(', ')}`);
  if (result.checksumErrors) parts.push(`${result.checksumErrors} CHECKSUM ERROR(S)`);
  return `${head}: ${parts.join(', ')}`;
}
