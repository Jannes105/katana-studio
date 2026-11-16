// Connection to the amp and the mirror of its current patch (PLAN 4.5). Framework-free: the UI subscribes through
// the store contract (`subscribe` calls the listener at once and on every change), which Svelte understands
// directly.
//
// The state keeps raw bytes per block (PatchImage); the model decodes them. Rules of PLAN 4.5 applied here:
//  1. the amp is the truth: an own write shows at once, then whatever the amp reports wins
//  2. while a value is written, and 300 ms after, incoming values for that address are ignored
//  3. patch change (DT1 at 00 00 00 00): clear the queue, wait for 100 ms of quiet (at most 300 ms), read again;
//     the unsaved changes of the channel that was left are remembered (PLAN 2)
//  4. the whole current patch comes with one range request
//  5. read again when the app returns to the foreground (onForeground) and after every reconnect
//  6. "unsaved" = difference to the stored slot of the channel, read in the background after each patch read
//     and after every save
//  8. after a restart or reconnect the app greets and reads, it never writes on its own
//  9. a pulled cable is a normal state: values freeze, the app reconnects when the amp comes back

import type { DeviceEvent, DeviceTransport, Transport } from '../midi/transport';
import {
  ADDR,
  PATCH_SLOT_NAMES,
  SIZE,
  isPatchIndex,
  storedPatchAddress,
  type Address,
} from '../protocol/address';
import { u2x4, u4x4, u7 } from '../protocol/encoding';
import { greet, modelName, type GreetingWarning } from '../protocol/greeting';
import { SendQueue, type Diagnostic } from '../protocol/queue';
import { hex, type ParsedMessage } from '../protocol/sysex';
import { PATCH_NAME } from '../model/params';
import { PatchImage, patchBlockAt, readText } from '../model/patch';
import type { BackupFile, PatchFile } from '../storage/format';
import { patchFileFrom, readBackup, type FileMeta } from './backup';
import { encodingSize, type ParamDef } from '../model/schema';

export const ECHO_GUARD_MS = 300;
export const PATCH_CHANGE_QUIET_MS = 100;
export const PATCH_CHANGE_MAX_WAIT_MS = 300;
export const LOG_LIMIT = 1000;

export type Phase = 'starting' | 'waiting' | 'connecting' | 'connected' | 'error';

/** One changed byte of a patch: offset from the patch base and its value. */
export interface ByteChange {
  readonly offset: Address;
  readonly value: number;
}

export interface ConnectionState {
  readonly phase: Phase;
  readonly device: string;
  readonly model: string | null;
  /** Model code from the identity reply (06 = KATANA-100). */
  readonly modelCode: number | null;
  readonly readOnly: boolean;
  readonly warnings: readonly GreetingWarning[];
  readonly error: string | null;
  readonly patchIndex: number | null;
  readonly patchName: string | null;
  /** Raw bytes of the current patch (edit buffer). Kept, frozen, while disconnected. */
  readonly current: PatchImage;
  /** Raw bytes of the stored slot of `storedIndex`. */
  readonly stored: PatchImage;
  readonly storedIndex: number | null;
  /** Offsets where the current patch differs from its stored slot; empty while the slot is not read yet. */
  readonly unsaved: readonly Address[];
  /** True once the stored slot of the current channel has been read, so `unsaved` is meaningful. */
  readonly unsavedKnown: boolean;
  /** Unsaved changes of channels that were left, by patch index (PLAN 2). Memory only. */
  readonly remembered: ReadonlyMap<number, readonly ByteChange[]>;
  /** True while the current patch is being read (controls are locked). */
  readonly reading: boolean;
  /** Time of the last complete read of the current patch. */
  readonly lastReadAt: number | null;
  /** True while a complete backup is being read. */
  readonly backingUp: boolean;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'in' | 'out';

export interface LogEntry {
  readonly time: number;
  readonly level: LogLevel;
  readonly text: string;
}

export interface ConnectionOptions {
  /** Wraps the device before the queue uses it, e.g. with the capture recorder. */
  readonly wrapTransport?: (t: Transport) => Transport;
  /** Logs every MIDI message too (verbose). */
  readonly logMessages?: boolean;
  readonly now?: () => number;
}

const INITIAL: ConnectionState = {
  phase: 'starting',
  device: '',
  model: null,
  modelCode: null,
  readOnly: false,
  warnings: [],
  error: null,
  patchIndex: null,
  patchName: null,
  current: PatchImage.EMPTY,
  stored: PatchImage.EMPTY,
  storedIndex: null,
  unsaved: [],
  unsavedKnown: false,
  remembered: new Map(),
  reading: false,
  lastReadAt: null,
  backingUp: false,
};

export function slotName(index: number | null): string {
  return index !== null && isPatchIndex(index) ? PATCH_SLOT_NAMES[index] : '–';
}

/**
 * Collects the DT1 of a range read of one patch, block by block. A whole block replaces what was there; a
 * partial DT1 (a report from the amp) patches a block already received. A partial DT1 before its block is
 * dropped: the block arrives later and is newer (a reply shows the state at the time of the answer).
 */
class PatchCollector {
  private readonly blocks = new Map<Address, number[]>();

  constructor(readonly base: Address) {}

  /** True if the address lies in this patch. */
  take(address: Address, data: readonly number[]): boolean {
    const offset = address - this.base;
    const b = patchBlockAt(offset);
    if (!b) return false;
    if (offset === b.offset && data.length === b.length) {
      this.blocks.set(b.offset, [...data]);
      return true;
    }
    const old = this.blocks.get(b.offset);
    if (old) data.forEach((v, i) => offset - b.offset + i < b.length && (old[offset - b.offset + i] = v));
    return true;
  }

  image(): PatchImage {
    return PatchImage.of(this.blocks);
  }
}

export class AmpConnection {
  private stateValue: ConnectionState;
  private readonly listeners = new Set<(s: ConnectionState) => void>();
  private readonly logListeners = new Set<(entries: readonly LogEntry[]) => void>();
  private logEntries: LogEntry[] = [];
  private queue: SendQueue | undefined;
  private readonly transport: Transport;
  private readonly now: () => number;
  private readonly logMessages: boolean;
  private connecting = false;
  /** Time of the last own write per patch offset (rule 2). */
  private readonly lastLocalWrite = new Map<Address, number>();
  private patchChangeTimer: ReturnType<typeof setTimeout> | undefined;
  private patchChangeSince = 0;
  private lastIncoming = 0;
  private readGeneration = 0;
  private storedGeneration = 0;
  private ownPatchNumberReads = 0;
  private currentCollector: PatchCollector | undefined;
  private storedCollector: PatchCollector | undefined;

  constructor(
    private readonly device: DeviceTransport,
    options: ConnectionOptions = {},
  ) {
    this.transport = options.wrapTransport ? options.wrapTransport(device) : device;
    this.now = options.now ?? (() => Date.now());
    this.logMessages = options.logMessages ?? false;
    this.stateValue = { ...INITIAL, device: device.name };
  }

  // ---- store contract ----

  subscribe(listener: (s: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.stateValue);
    return () => this.listeners.delete(listener);
  }

  get state(): ConnectionState {
    return this.stateValue;
  }

  /** The log as a store: the listener gets the whole list on every change. */
  readonly log = {
    subscribe: (listener: (entries: readonly LogEntry[]) => void): (() => void) => {
      this.logListeners.add(listener);
      listener(this.logEntries);
      return () => this.logListeners.delete(listener);
    },
  };

  // ---- actions ----

  /** Subscribes to the device and connects if the amp is already plugged in. */
  async start(): Promise<void> {
    this.device.onEvent((e) => this.onDeviceEvent(e));
    await this.device.start();
    const attached = await this.device.isAttached().catch(() => false);
    this.addLog('info', `${this.device.name}: ${attached ? 'amp attached' : 'no amp attached'}`);
    if (attached) await this.connect();
    else this.update({ phase: 'waiting' });
  }

  /** Opens the device, greets the amp and reads the current patch. Safe to call again (retry button). */
  async connect(): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;
    this.update({ phase: 'connecting', error: null });
    try {
      this.queue?.close('reconnect');
      await this.device.open();
      const queue = new SendQueue(this.transport, { onDiagnostic: (d) => this.onDiagnostic(d) });
      this.queue = queue;
      queue.onMessage((m) => this.onMessage(m));
      const g = await greet(queue);
      for (const w of g.warnings) this.addLog('warn', `Greeting: unexpected ${w.kind} ${w.got}`);
      this.addLog(
        'info',
        `Greeting done: ${modelName(g.modelCode)}, editor mode ${g.editorMode ?? 'not set'}`,
      );
      this.update({
        phase: 'connected',
        model: modelName(g.modelCode),
        modelCode: g.modelCode,
        readOnly: g.readOnly,
        warnings: g.warnings,
      });
      await this.readCurrent();
    } catch (error) {
      // Unplugged during the greeting: the detach already set "waiting"; that is not an error.
      if (isCancelled(error) && this.stateValue.phase === 'waiting') return;
      this.fail(error);
    } finally {
      this.connecting = false;
    }
  }

  /**
   * Reads patch number and the whole current patch (one range request), then the stored slot of that channel in
   * the background (for "unsaved"). Also the "Read again" button.
   */
  async readCurrent(): Promise<void> {
    const queue = this.queue;
    if (!queue || this.stateValue.phase !== 'connected') return;
    const generation = ++this.readGeneration;
    const before = this.stateValue.patchIndex;
    this.update({ reading: true });
    const collector = new PatchCollector(ADDR.currentPatch);
    this.currentCollector = collector;
    try {
      // The reply to our own read of 00 00 00 00 looks exactly like the patch-change report. While this read
      // is open, a DT1 there is taken as the reply (its listener runs before the read resolves).
      this.ownPatchNumberReads++;
      const numberRead = queue.readBytes(ADDR.patchNumber, 2).finally(() => this.ownPatchNumberReads--);
      const [number, reply] = await Promise.all([numberRead, queue.read(ADDR.currentPatch, SIZE.patch)]);
      if (generation !== this.readGeneration) return; // a newer read took over
      this.currentCollector = undefined;
      const index = number.length === 2 ? u2x4.decode([...number]) : null;
      if (before !== null && index !== null && index !== before && !this.patchChangePending()) {
        // The channel changed while we were reading; the bytes may belong to the old one.
        this.onPatchChange([...number]);
        return;
      }
      let image = collector.image();
      if (!image.complete) image = PatchImage.fromReply(reply.blocks, ADDR.currentPatch);
      image = this.keepGuarded(image);
      const sameChannel = index === this.stateValue.storedIndex;
      this.update({
        patchIndex: index,
        current: image,
        patchName: readText(image, PATCH_NAME) ?? null,
        reading: false,
        lastReadAt: this.now(),
        ...(sameChannel ? {} : { stored: PatchImage.EMPTY, storedIndex: null }),
      });
      this.updateUnsaved();
      this.addLog(
        'info',
        `Read ${slotName(index)} "${this.stateValue.patchName ?? '?'}": ${image.size} blocks`,
      );
      if (index !== null) await this.readStored(index);
    } catch (error) {
      if (generation !== this.readGeneration) return;
      this.currentCollector = undefined;
      this.update({ reading: false });
      if (isCancelled(error)) return; // a patch change cleared the queue; a new read follows
      this.fail(error);
    }
  }

  /** Rule 5: the app came back to the foreground. Re-reads unless a read is already running. */
  onForeground(): void {
    const s = this.stateValue;
    if (s.phase !== 'connected' || s.reading || this.patchChangePending()) return;
    this.addLog('info', 'Back in the foreground: reading again');
    void this.readCurrent();
  }

  /**
   * Writes a parameter of the current patch (raw value, clamped to its range). Shown at once (rule 1). Refused
   * while reading, read-only, disconnected, or for read-only parameters.
   */
  async setValue(def: ParamDef, raw: number): Promise<void> {
    const queue = this.queue;
    const s = this.stateValue;
    if (!queue || s.phase !== 'connected' || s.readOnly || s.reading || def.readonly) return;
    if (def.encoding === 'ascii16') return; // names come later
    const v = Math.min(def.max, Math.max(def.min, Math.round(raw)));
    const data = def.encoding === 'u4x4' ? u4x4.encode(v) : u7.encode(v);
    const stamp = (): void => {
      for (let i = 0; i < encodingSize(def.encoding); i++) this.lastLocalWrite.set(def.at + i, this.now());
    };
    stamp();
    this.update({ current: s.current.with(def.at, data) });
    this.updateUnsaved();
    try {
      await queue.write(ADDR.currentPatch + def.at, data);
      stamp();
    } catch (error) {
      if (!isCancelled(error)) this.addLog('error', `Write failed: ${describe(error)}`);
    }
  }

  /**
   * Reads a complete backup (PLAN 4.6), read-only. Rejects while not connected, while reading, or when the
   * amp is unplugged or the channel changes during the backup; there is never half a file.
   */
  async readBackup(meta: FileMeta): Promise<BackupFile> {
    const queue = this.queue;
    const s = this.stateValue;
    if (!queue || s.phase !== 'connected') throw new Error('Not connected');
    if (s.reading || s.backingUp) throw new Error('Busy, try again in a moment');
    this.update({ backingUp: true });
    this.addLog('info', 'Backup: reading SYSTEM, stored slots and the current patch');
    const started = this.now();
    try {
      const file = await readBackup(queue, s.patchIndex, meta);
      this.addLog('info', `Backup read in ${((this.now() - started) / 1000).toFixed(1)} s`);
      return file;
    } catch (error) {
      const text = isCancelled(error) ? 'Backup aborted (channel change or amp unplugged)' : describe(error);
      this.addLog('error', text);
      throw new Error(text, { cause: error });
    } finally {
      this.update({ backingUp: false });
    }
  }

  /** The current patch as a patch file, from the mirror (nothing is read). */
  currentPatchFile(meta: FileMeta): PatchFile {
    return patchFileFrom(this.stateValue.current, this.stateValue.patchIndex, meta);
  }

  /** Forgets the remembered changes of a channel ("discard"). */
  discardRemembered(index: number): void {
    if (!this.stateValue.remembered.has(index)) return;
    const remembered = new Map(this.stateValue.remembered);
    remembered.delete(index);
    this.update({ remembered });
  }

  /** Adds a line to the log (also used by the UI, e.g. for markers). */
  addLog(level: LogLevel, text: string): void {
    this.logEntries = [...this.logEntries, { time: this.now(), level, text }];
    if (this.logEntries.length > LOG_LIMIT) this.logEntries = this.logEntries.slice(-LOG_LIMIT);
    for (const l of this.logListeners) l(this.logEntries);
  }

  clearLog(): void {
    this.logEntries = [];
    for (const l of this.logListeners) l(this.logEntries);
  }

  // ---- internals ----

  /** Reads the stored slot of a channel in the background (rule 6). */
  private async readStored(index: number): Promise<void> {
    const queue = this.queue;
    if (!queue || !isPatchIndex(index)) return;
    const generation = ++this.storedGeneration;
    const base = storedPatchAddress(index);
    const collector = new PatchCollector(base);
    this.storedCollector = collector;
    try {
      const reply = await queue.read(base, SIZE.patch);
      if (generation !== this.storedGeneration || index !== this.stateValue.patchIndex) return;
      let image = collector.image();
      if (!image.complete) image = PatchImage.fromReply(reply.blocks, base);
      this.update({ stored: image, storedIndex: index });
      this.updateUnsaved();
    } catch (error) {
      if (generation !== this.storedGeneration || isCancelled(error)) return;
      this.addLog('warn', `Reading the stored ${slotName(index)} failed: ${describe(error)}`);
    } finally {
      if (this.storedCollector === collector) this.storedCollector = undefined;
    }
  }

  private onDeviceEvent(e: DeviceEvent): void {
    switch (e.kind) {
      case 'attached':
        this.addLog('info', 'Amp plugged in');
        void this.connect();
        break;
      case 'detached':
        this.addLog('warn', 'Amp unplugged');
        this.queue?.close('amp unplugged');
        this.queue = undefined;
        clearTimeout(this.patchChangeTimer);
        this.patchChangeTimer = undefined;
        this.currentCollector = undefined;
        this.storedCollector = undefined;
        // Values stay visible but frozen; nothing is written (rule 9).
        this.update({ phase: 'waiting', error: null, reading: false });
        break;
      case 'error':
        this.addLog('error', `${this.device.name}: ${e.message}`);
        break;
      case 'log':
        this.addLog('info', `${this.device.name}: ${e.message}`);
        break;
      case 'state':
        break;
    }
  }

  private onMessage(m: ParsedMessage): void {
    this.lastIncoming = this.now();
    if (this.logMessages) this.addLog('in', hex([...m.bytes]));
    if (m.type !== 'dt1') return;

    if (m.address === ADDR.patchNumber) {
      if (this.ownPatchNumberReads === 0) this.onPatchChange(m.data);
      return;
    }
    if (m.address === ADDR.patchWrite) {
      this.onSaved(m.data);
      return;
    }
    if (this.storedCollector?.take(m.address, m.data)) return;
    if (this.currentCollector) {
      this.currentCollector.take(m.address, m.data);
      return;
    }
    const offset = m.address - ADDR.currentPatch;
    if (!patchBlockAt(offset) || this.patchChangePending()) return;
    // A report from the amp (knob, button): applied except for bytes under the write guard (rule 2).
    const current = this.stateValue.current;
    const now = this.now();
    const data = m.data.map((v, i) => {
      const guardedUntil = (this.lastLocalWrite.get(offset + i) ?? -Infinity) + ECHO_GUARD_MS;
      return now < guardedUntil ? (current.read(offset + i, 1)?.[0] ?? v) : v;
    });
    const next = current.with(offset, data);
    if (next === current) return;
    this.update({ current: next, patchName: readText(next, PATCH_NAME) ?? null });
    this.updateUnsaved();
  }

  /** Saving on the amp (or the acknowledgement of PATCH_WRITE): the slot is read again, its memory forgotten. */
  private onSaved(data: readonly number[]): void {
    const index = data.length === 2 ? u2x4.decode([...data]) : null;
    if (index === null) return;
    this.addLog('info', `Saved on ${slotName(index)}`);
    this.discardRemembered(index);
    if (index === this.stateValue.patchIndex && !this.patchChangePending()) void this.readStored(index);
  }

  /** Rule 3 of PLAN 4.5. */
  private onPatchChange(data: readonly number[]): void {
    const index = data.length === 2 ? u2x4.decode([...data]) : null;
    this.addLog('info', `Patch change to ${slotName(index)}`);
    this.rememberLeftChannel(index);
    this.lastLocalWrite.clear(); // guards belong to the patch that was left
    this.queue?.clear();
    this.readGeneration++; // a running read is void
    this.storedGeneration++;
    this.currentCollector = undefined;
    this.storedCollector = undefined;
    this.update({ patchIndex: index, reading: true });
    if (!this.patchChangePending()) this.patchChangeSince = this.now();
    clearTimeout(this.patchChangeTimer);
    this.schedulePatchRead();
  }

  /** PLAN 2: the unsaved changes of the channel that is left are kept (memory only). */
  private rememberLeftChannel(next: number | null): void {
    const s = this.stateValue;
    const left = s.patchIndex;
    if (left === null || left === next || this.patchChangePending() || !s.unsavedKnown) return;
    if (s.unsaved.length === 0) return; // nothing new; earlier remembered changes stay
    const changes = s.unsaved.map((offset) => ({ offset, value: s.current.read(offset, 1)?.[0] ?? 0 }));
    const remembered = new Map(s.remembered);
    remembered.set(left, changes);
    this.update({ remembered });
    this.addLog('info', `Remembered ${changes.length} unsaved bytes of ${slotName(left)}`);
  }

  private patchChangePending(): boolean {
    return this.patchChangeTimer !== undefined;
  }

  private schedulePatchRead(): void {
    const sinceSignal = this.now() - this.patchChangeSince;
    const sinceLast = this.now() - this.lastIncoming;
    const wait = Math.max(
      0,
      Math.min(PATCH_CHANGE_QUIET_MS - sinceLast, PATCH_CHANGE_MAX_WAIT_MS - sinceSignal),
    );
    this.patchChangeTimer = setTimeout(() => {
      const quiet = this.now() - this.lastIncoming >= PATCH_CHANGE_QUIET_MS;
      const timeUp = this.now() - this.patchChangeSince >= PATCH_CHANGE_MAX_WAIT_MS;
      if (!quiet && !timeUp) {
        this.schedulePatchRead();
        return;
      }
      this.patchChangeTimer = undefined;
      void this.readCurrent();
    }, wait);
  }

  /** Rule 2 for a fresh read: bytes written in the last 300 ms keep their local value. */
  private keepGuarded(image: PatchImage): PatchImage {
    const now = this.now();
    const old = this.stateValue.current;
    let out = image;
    for (const [offset, at] of this.lastLocalWrite) {
      if (now >= at + ECHO_GUARD_MS) {
        this.lastLocalWrite.delete(offset);
        continue;
      }
      const v = old.read(offset, 1);
      if (v) out = out.with(offset, v);
    }
    return out;
  }

  private updateUnsaved(): void {
    const s = this.stateValue;
    const known =
      s.patchIndex !== null && s.storedIndex === s.patchIndex && s.stored.complete && s.current.complete;
    const unsaved = known ? s.current.diff(s.stored) : [];
    if (known === s.unsavedKnown && sameList(unsaved, s.unsaved)) return;
    this.update({ unsaved, unsavedKnown: known });
  }

  private onDiagnostic(d: Diagnostic): void {
    switch (d.kind) {
      case 'retry':
        this.addLog('warn', `No reply, retrying: ${d.what}`);
        break;
      case 'bad-checksum':
        this.addLog('warn', `Bad checksum: ${hex([...d.message.bytes])}`);
        break;
      case 'foreign-device':
        this.addLog('warn', `Foreign device ID: ${hex([...d.message.bytes])}`);
        break;
      case 'send-failed':
        this.addLog('error', `Send failed (${d.what}): ${describe(d.error)}`);
        break;
    }
  }

  private fail(error: unknown): void {
    const text = describe(error);
    this.addLog('error', text);
    this.update({ phase: 'error', error: text, reading: false });
  }

  private update(patch: Partial<ConnectionState>): void {
    this.stateValue = { ...this.stateValue, ...patch };
    for (const l of this.listeners) l(this.stateValue);
  }
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function isCancelled(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'QueueCancelledError' || error.name === 'QueueClosedError')
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
