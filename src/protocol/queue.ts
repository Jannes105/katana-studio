// Send queue (PLAN 4.2, rules agreed 2026-11-16). Every message to the amp goes through here.
//
//  1. Writing before reading: a DT1 never waits for an open RQ1.
//  2. Only one send is in flight to the transport; a waiting DT1 with the same address and length is replaced
//     by the newer one (slider values coalesce).
//  3. After a DT1 with more than 16 data bytes the BTS gap applies (20 ms + message length / 3.125 ms) until
//     large writes are measured; small messages go out without a gap (protocol-notes 2.13).
//  4. Only one RQ1 (or identity request) is open. Replies are matched by address: a range request is complete
//     once every expected block address has arrived (block table), a single read with the first DT1 at its
//     address. A report from the amp inside the range counts as a reply; the newest value wins.
//  5. Timeout means no progress: 500 ms without a matching message. Then one retry of the whole request
//     (blocks already received are kept), then the request fails with QueueTimeoutError.
//  6. clear() drops everything waiting and cancels the open request (patch change); late replies then arrive as
//     plain reports.
//  7. Every accepted incoming message goes to the listeners, replies and reports alike.
//  8. Safety net: no DT1 into the stored slots and no PATCH_WRITE unless explicitly allowed.
//  9. Reads are sent in the order they were requested.

import type { Transport } from '../midi/transport';
import { ADDR, SIZE, formatAddress, storedPatchAddress, type Address } from './address';
import { expectedBlockAddresses } from './blocks';
import {
  IDENTITY_REQUEST,
  acceptsDeviceId,
  buildDt1,
  buildRq1,
  parseMessage,
  type Dt1Message,
  type IdentityReply,
  type ParsedMessage,
} from './sysex';

export const PROGRESS_TIMEOUT_MS = 500;
export const RETRIES = 1;
/** DT1 with more data bytes than this get the BTS gap afterwards (rule 3). */
export const LARGE_DT1_THRESHOLD = 16;

/** BTS send pacing: 20 ms plus message length / 3.125 ms. */
export function largeWriteGapMs(messageLength: number): number {
  return 20 + messageLength / 3.125;
}

/** Stored slots, PREVIEW included: never written before Phase 4 (rule 8). */
const STORED_SLOTS_START = ADDR.storedPatchBase;
const STORED_SLOTS_END = storedPatchAddress(9) + SIZE.storedPatchStride;

export class QueueTimeoutError extends Error {
  constructor(what: string) {
    super(`No reply from the amp: ${what}`);
    this.name = 'QueueTimeoutError';
  }
}

export class QueueCancelledError extends Error {
  constructor(what: string) {
    super(`Cancelled: ${what}`);
    this.name = 'QueueCancelledError';
  }
}

export class QueueClosedError extends Error {
  constructor(reason: string) {
    super(`Connection closed: ${reason}`);
    this.name = 'QueueClosedError';
  }
}

export class WriteBlockedError extends Error {
  constructor(what: string) {
    super(`Write blocked: ${what}`);
    this.name = 'WriteBlockedError';
  }
}

export interface WriteOptions {
  /** Allows DT1 into the stored slots (Phase 4 only). */
  readonly allowStoredSlots?: boolean;
  /** Allows PATCH_WRITE (saving on the amp, only after the user confirmed). */
  readonly allowPatchWrite?: boolean;
}

/** Reply to a read: the data of every DT1 in the requested range, by address. */
export interface ReadReply {
  readonly address: Address;
  readonly size: number;
  readonly blocks: ReadonlyMap<Address, readonly number[]>;
}

export type Diagnostic =
  | { kind: 'bad-checksum'; message: ParsedMessage }
  | { kind: 'foreign-device'; message: ParsedMessage }
  | { kind: 'retry'; what: string }
  | { kind: 'send-failed'; what: string; error: unknown };

export interface QueueOptions {
  readonly progressTimeoutMs?: number;
  readonly retries?: number;
  readonly onDiagnostic?: (d: Diagnostic) => void;
}

interface PendingWrite {
  readonly address: Address;
  data: readonly number[];
  readonly settle: { resolve: () => void; reject: (e: unknown) => void }[];
}

interface OpenRequestBase {
  readonly what: string;
  readonly bytes: readonly number[];
  retriesLeft: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface IdentityRequest extends OpenRequestBase {
  readonly kind: 'identity';
  readonly resolve: (reply: IdentityReply) => void;
  readonly reject: (e: unknown) => void;
}

interface ReadRequest extends OpenRequestBase {
  readonly kind: 'read';
  readonly address: Address;
  readonly size: number;
  /** Block addresses still missing; empty set = single read, completed by a DT1 at `address`. */
  readonly missing: Set<Address>;
  readonly isRange: boolean;
  readonly blocks: Map<Address, readonly number[]>;
  readonly resolve: (reply: ReadReply) => void;
  readonly reject: (e: unknown) => void;
}

type Request = IdentityRequest | ReadRequest;

export class SendQueue {
  private readonly progressTimeoutMs: number;
  private readonly retries: number;
  private readonly onDiagnostic: ((d: Diagnostic) => void) | undefined;

  private deviceIdValue: number | undefined;
  private readonly writes: PendingWrite[] = [];
  private readonly requests: Request[] = [];
  private open: Request | undefined;
  private resendOpen = false;
  private pumping = false;
  private gapUntil = 0;
  private closedReason: string | undefined;
  private readonly listeners = new Set<(m: ParsedMessage) => void>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly transport: Transport,
    options: QueueOptions = {},
  ) {
    this.progressTimeoutMs = options.progressTimeoutMs ?? PROGRESS_TIMEOUT_MS;
    this.retries = options.retries ?? RETRIES;
    this.onDiagnostic = options.onDiagnostic;
    this.unsubscribe = transport.onMessage((bytes) => this.receive(bytes));
  }

  /** Device ID learned from the identity reply; undefined before `identify`. */
  get deviceId(): number | undefined {
    return this.deviceIdValue;
  }

  /** Every accepted incoming message (rule 7). Returns a function that removes the listener. */
  onMessage(listener: (m: ParsedMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Identity request (broadcast). The reply sets the device ID for all later messages. */
  identify(): Promise<IdentityReply> {
    return new Promise((resolve, reject) => {
      if (this.closedReason !== undefined) return reject(new QueueClosedError(this.closedReason));
      this.requests.push({
        kind: 'identity',
        what: 'identity request',
        bytes: IDENTITY_REQUEST,
        retriesLeft: this.retries,
        timer: undefined,
        resolve,
        reject,
      });
      this.pump();
    });
  }

  /** RQ1 of `size` bytes (linear). Resolves with every DT1 of the range. */
  read(address: Address, size: number): Promise<ReadReply> {
    return new Promise((resolve, reject) => {
      if (this.closedReason !== undefined) return reject(new QueueClosedError(this.closedReason));
      const deviceId = this.deviceIdValue;
      if (deviceId === undefined) return reject(new Error('Not identified yet: call identify() first'));
      const expected = expectedBlockAddresses(address, size);
      this.requests.push({
        kind: 'read',
        what: `RQ1 ${formatAddress(address)} size ${formatAddress(size)}`,
        bytes: buildRq1(deviceId, address, size),
        retriesLeft: this.retries,
        timer: undefined,
        address,
        size,
        missing: new Set(expected),
        isRange: expected.length > 0,
        blocks: new Map(),
        resolve,
        reject,
      });
      this.pump();
    });
  }

  /** Convenience for small reads: the data of the DT1 at `address`. */
  async readBytes(address: Address, size: number): Promise<readonly number[]> {
    const reply = await this.read(address, size);
    return reply.blocks.get(address) ?? [];
  }

  /** DT1. Resolves once sent (the amp does not acknowledge writes; verify by reading back). */
  write(address: Address, data: readonly number[], options: WriteOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closedReason !== undefined) return reject(new QueueClosedError(this.closedReason));
      if (this.deviceIdValue === undefined)
        return reject(new Error('Not identified yet: call identify() first'));
      const blocked = this.checkWrite(address, data.length, options);
      if (blocked) return reject(new WriteBlockedError(blocked));

      // Rule 2: replace a waiting write with the same address and length.
      const waiting = this.writes.find((w) => w.address === address && w.data.length === data.length);
      if (waiting) {
        waiting.data = data;
        waiting.settle.push({ resolve, reject });
      } else {
        this.writes.push({ address, data, settle: [{ resolve, reject }] });
      }
      this.pump();
    });
  }

  /** Rule 6: drops everything waiting and cancels the open request. A send already in flight completes. */
  clear(): void {
    this.cancelAll((what) => new QueueCancelledError(what));
  }

  /** Disconnect: rejects everything and refuses further calls. */
  close(reason = 'closed'): void {
    if (this.closedReason !== undefined) return;
    this.closedReason = reason;
    this.cancelAll(() => new QueueClosedError(reason));
    this.unsubscribe();
    this.listeners.clear();
  }

  // ---- internals ----

  private checkWrite(address: Address, length: number, options: WriteOptions): string | undefined {
    const end = address + length;
    if (!options.allowStoredSlots && address < STORED_SLOTS_END && end > STORED_SLOTS_START) {
      return `DT1 ${formatAddress(address)} lies in the stored slots`;
    }
    if (!options.allowPatchWrite && address <= ADDR.patchWrite && end > ADDR.patchWrite) {
      return 'PATCH_WRITE needs explicit confirmation';
    }
    return undefined;
  }

  private cancelAll(makeError: (what: string) => Error): void {
    for (const w of this.writes.splice(0)) {
      const e = makeError(`DT1 ${formatAddress(w.address)}`);
      for (const s of w.settle) s.reject(e);
    }
    for (const r of this.requests.splice(0)) r.reject(makeError(r.what));
    const open = this.open;
    if (open) {
      clearTimeout(open.timer);
      this.open = undefined;
      this.resendOpen = false;
      open.reject(makeError(open.what));
    }
  }

  /** Sends whatever is due, one message at a time. Re-entrant calls return at once. */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    void this.drain();
  }

  private async drain(): Promise<void> {
    // The loop sits directly inside try: `finally` then runs in the same tick as the last "nothing due"
    // check, so a pump() call right after it cannot be lost.
    try {
      for (;;) {
        const wait = this.gapUntil - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (this.closedReason !== undefined) return;

        // Rule 1: writes first, even while a request is open.
        const write = this.writes.shift();
        if (write) {
          await this.sendWrite(write);
          continue;
        }

        if (this.open && this.resendOpen) {
          this.resendOpen = false;
          await this.sendRequest(this.open);
          continue;
        }

        // Rule 4: only one request open.
        if (!this.open) {
          const next = this.requests.shift();
          if (next) {
            this.open = next;
            await this.sendRequest(next);
            continue;
          }
        }
        return;
      }
    } finally {
      this.pumping = false;
    }
  }

  private async sendWrite(write: PendingWrite): Promise<void> {
    const deviceId = this.deviceIdValue ?? 0;
    const bytes = buildDt1(deviceId, write.address, write.data);
    try {
      await this.transport.send(bytes);
      // Rule 3: gap after a large DT1.
      // Rounded up: timers take whole milliseconds and must not fire early.
      if (write.data.length > LARGE_DT1_THRESHOLD) {
        this.gapUntil = Date.now() + Math.ceil(largeWriteGapMs(bytes.length));
      }
      for (const s of write.settle) s.resolve();
    } catch (error) {
      this.onDiagnostic?.({ kind: 'send-failed', what: `DT1 ${formatAddress(write.address)}`, error });
      for (const s of write.settle) s.reject(error);
    }
  }

  private async sendRequest(request: Request): Promise<void> {
    try {
      await this.transport.send(request.bytes);
    } catch (error) {
      this.onDiagnostic?.({ kind: 'send-failed', what: request.what, error });
      if (this.open === request) this.finish(request);
      request.reject(error);
      return;
    }
    if (this.open === request) this.armTimer(request);
  }

  /** Rule 5: (re)starts the no-progress timer. */
  private armTimer(request: Request): void {
    clearTimeout(request.timer);
    request.timer = setTimeout(() => this.onTimeout(request), this.progressTimeoutMs);
  }

  private onTimeout(request: Request): void {
    if (this.open !== request) return;
    if (request.retriesLeft > 0) {
      request.retriesLeft--;
      this.onDiagnostic?.({ kind: 'retry', what: request.what });
      this.resendOpen = true;
      this.pump();
      return;
    }
    this.finish(request);
    request.reject(new QueueTimeoutError(request.what));
  }

  /** Closes the open request and lets the next one go. */
  private finish(request: Request): void {
    clearTimeout(request.timer);
    if (this.open === request) {
      this.open = undefined;
      this.resendOpen = false;
    }
    this.pump();
  }

  private receive(bytes: readonly number[]): void {
    const message = parseMessage(bytes);

    if (message.type === 'dt1' || message.type === 'rq1') {
      if (!message.checksumOk) {
        this.onDiagnostic?.({ kind: 'bad-checksum', message });
        return;
      }
      if (this.deviceIdValue !== undefined && !acceptsDeviceId(this.deviceIdValue, message.deviceId)) {
        this.onDiagnostic?.({ kind: 'foreign-device', message });
        return;
      }
    }

    const open = this.open;
    if (open?.kind === 'identity' && message.type === 'identity') {
      this.deviceIdValue = message.deviceId;
      this.finish(open);
      open.resolve(message);
    } else if (open?.kind === 'read' && message.type === 'dt1') {
      this.matchRead(open, message);
    }

    for (const listener of this.listeners) listener(message);
  }

  private matchRead(request: ReadRequest, message: Dt1Message): void {
    const a = message.address;
    if (a < request.address || a >= request.address + request.size) return; // not ours: a report
    request.blocks.set(a, message.data); // newest value wins

    if (request.isRange) {
      if (!request.missing.delete(a)) return;
      if (request.missing.size > 0) {
        this.armTimer(request); // progress
        return;
      }
    } else if (a !== request.address) {
      return;
    }
    this.finish(request);
    request.resolve({ address: request.address, size: request.size, blocks: request.blocks });
  }
}
