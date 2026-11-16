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
//  7. back to the stored state: per parameter (revertParam), all (revertAll), each with undo; remembered
//     changes of a channel are written back only on request (restoreRemembered)
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
import { PATCH_NAME, PATCH_PARAMS, VARIATION_PARAMS } from '../model/params';
import { PatchImage, patchBlockAt, readText } from '../model/patch';
import type { BackupFile, PatchFile } from '../storage/format';
import { patchFileFrom, readBackup, type FileMeta } from './backup';
import { encodingSize, writable, type ParamDef } from '../model/schema';

export const ECHO_GUARD_MS = 300;
export const PATCH_CHANGE_QUIET_MS = 100;
export const PATCH_CHANGE_MAX_WAIT_MS = 300;
export const LOG_LIMIT = 1000;

/** Channels the app may select (PLAN 5, 1b: A1–B4; the Panel is only shown). */
export const SELECTABLE_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type Phase = 'starting' | 'waiting' | 'connecting' | 'connected' | 'error';

/** One changed byte of a patch: offset from the patch base and its value. */
export interface ByteChange {
  readonly offset: Address;
  readonly value: number;
}

/**
 * Result of writing several bytes (reset, revert all, restore, undo). `previous` holds the values before the
 * write, so passing the result to undo() writes them back.
 */
export interface WriteResult {
  readonly previous: readonly ByteChange[];
  /** Changed bytes that were left alone because no writable parameter covers them (PLAN 4.4). */
  readonly skipped: number;
  /** Patch change counter at the time of the write; undo() refuses after a patch change. */
  readonly generation: number;
}

/** Every writable parameter by each of its byte offsets (PLAN 4.4: only addresses from our list are written). */
const WRITABLE_AT: ReadonlyMap<Address, ParamDef> = new Map(
  [...PATCH_PARAMS, ...VARIATION_PARAMS]
    .filter(writable)
    .flatMap((p) => Array.from({ length: encodingSize(p.encoding) }, (_, i) => [p.at + i, p] as const)),
);

/** The writable parameter that covers a patch offset, if any. */
export function writableParamAt(offset: Address): ParamDef | undefined {
  return WRITABLE_AT.get(offset);
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
  /** Counts patch changes; an undo from before a change is refused. */
  private patchGeneration = 0;
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
   * while reading, read-only, disconnected, and for parameters that are not writable (read-only, or the
   * address not yet confirmed on the amp). Parameters of a variation go through instanceParam().
   */
  async setValue(def: ParamDef, raw: number): Promise<void> {
    if (!this.canWrite() || !writable(def)) return;
    const v = Math.min(def.max, Math.max(def.min, Math.round(raw)));
    const data = def.encoding === 'u4x4' ? u4x4.encode(v) : u7.encode(v);
    await this.writeRuns([{ offset: def.at, data }]);
  }

  /** True while writes are allowed: connected, not read-only, not reading, no backup running. */
  canWrite(): boolean {
    const s = this.stateValue;
    return (
      this.queue !== undefined &&
      s.phase === 'connected' &&
      !s.readOnly &&
      !s.reading &&
      !s.backingUp &&
      s.current.complete
    );
  }

  /**
   * Writes single bytes of the current patch (reset, revert all, restore, undo). Each byte goes out with its
   * whole parameter, one DT1 per parameter (same address and length as a knob write, so the queue's
   * coalescing stays consistent). Bytes no writable parameter covers are skipped and counted. Returns null
   * when writing is not allowed right now.
   */
  async writeBytes(changes: readonly ByteChange[]): Promise<WriteResult | null> {
    if (!this.canWrite()) return null;
    const s = this.stateValue;
    const generation = this.patchGeneration;
    const target = new Map<Address, number>();
    let skipped = 0;
    for (const c of changes) {
      if (!writableParamAt(c.offset) || !Number.isInteger(c.value) || c.value < 0 || c.value > 0x7f)
        skipped++;
      else target.set(c.offset, c.value);
    }
    const previous: ByteChange[] = [];
    const runs = new Map<Address, number[]>();
    for (const [offset, value] of [...target].sort((a, b) => a[0] - b[0])) {
      const old = s.current.read(offset, 1)?.[0];
      if (old === undefined || old === value) continue;
      previous.push({ offset, value: old });
      const def = writableParamAt(offset);
      if (!def) continue;
      const run = runs.get(def.at) ?? [...(s.current.read(def.at, encodingSize(def.encoding)) ?? [])];
      run[offset - def.at] = value;
      runs.set(def.at, run);
    }
    await this.writeRuns([...runs].map(([offset, data]) => ({ offset, data })));
    return { previous, skipped, generation };
  }

  /** Double tap on a knob (rule 7): the parameter goes back to the stored value of the channel. */
  async revertParam(def: ParamDef): Promise<WriteResult | null> {
    const s = this.stateValue;
    if (!s.unsavedKnown) return null;
    const stored = s.stored.read(def.at, encodingSize(def.encoding));
    if (!stored) return null;
    return this.writeBytes(stored.map((value, i) => ({ offset: def.at + i, value })));
  }

  /** "Revert all" (rule 7): every byte that differs from the stored slot goes back to the stored value. */
  async revertAll(): Promise<WriteResult | null> {
    const s = this.stateValue;
    if (!s.unsavedKnown) return null;
    return this.writeBytes(
      s.unsaved.map((offset) => ({ offset, value: s.stored.read(offset, 1)?.[0] ?? -1 })),
    );
  }

  /**
   * "Restore" (PLAN 2, rule 7): writes the remembered changes of the current channel into the current patch,
   * only on request, then forgets them.
   */
  async restoreRemembered(): Promise<WriteResult | null> {
    const index = this.stateValue.patchIndex;
    const changes = index === null ? undefined : this.stateValue.remembered.get(index);
    if (index === null || !changes) return null;
    const result = await this.writeBytes(changes);
    if (result) {
      this.discardRemembered(index);
      this.addLog('info', `Restored ${result.previous.length} remembered bytes of ${slotName(index)}`);
    }
    return result;
  }

  /** Undo of a reset, revert or restore: writes the previous values back, unless the patch changed since. */
  async undo(result: WriteResult): Promise<WriteResult | null> {
    if (result.generation !== this.patchGeneration || this.patchChangePending()) return null;
    return this.writeBytes(result.previous);
  }

  /**
   * Selects a channel A1–B4 by PATCH_SELECT (PLAN 2: no question; the unsaved changes of the channel that is
   * left are remembered by the patch-change report that follows). Not the Panel, not the active channel
   * (selecting it again would reload the stored slot and lose the unsaved changes). Returns false if refused.
   */
  async selectChannel(index: number): Promise<boolean> {
    const queue = this.queue;
    const s = this.stateValue;
    if (!queue || !this.canWrite() || index === s.patchIndex) return false;
    if (!(SELECTABLE_CHANNELS as readonly number[]).includes(index)) return false;
    this.addLog('info', `Selecting ${slotName(index)}`);
    try {
      await queue.write(ADDR.patchSelect, u2x4.encode(index));
      return true;
    } catch (error) {
      if (!isCancelled(error)) this.addLog('error', `Channel select failed: ${describe(error)}`);
      return false;
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

  /** Shows the bytes at once (rule 1), guards them (rule 2) and sends one DT1 per run. */
  private async writeRuns(runs: readonly { offset: Address; data: readonly number[] }[]): Promise<void> {
    const queue = this.queue;
    if (!queue || runs.length === 0) return;
    const stamp = (): void => {
      const now = this.now();
      for (const r of runs) r.data.forEach((_, i) => this.lastLocalWrite.set(r.offset + i, now));
    };
    stamp();
    let current = this.stateValue.current;
    for (const r of runs) current = current.with(r.offset, r.data);
    this.update({ current });
    this.updateUnsaved();
    try {
      await Promise.all(runs.map((r) => queue.write(ADDR.currentPatch + r.offset, r.data)));
      stamp();
    } catch (error) {
      if (!isCancelled(error)) this.addLog('error', `Write failed: ${describe(error)}`);
    }
  }

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
    this.patchGeneration++;
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
