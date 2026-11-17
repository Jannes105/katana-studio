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
//  7. back to the stored state: per parameter (revertParam), all (revertAll, whole blocks), each with undo;
//     remembered changes of a channel are written back only on request (restoreRemembered, whole blocks)
//  8. after a restart or reconnect the app greets and reads, it never writes on its own
//  9. a pulled cable is a normal state: values freeze, the app reconnects when the amp comes back
// 10. saving onto the channel only after the user confirmed (save): PATCH_WRITE, wait for the acknowledgement,
//     read the slot back and compare it with the patch at the time of saving (PLAN 4.3, protocol-notes 2.15)

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
import { PATCH_BLOCKS, READ_ONLY_PATCH_OFFSETS, WRITABLE_PATCH_BLOCKS, blockKey } from '../protocol/blocks';
import { patchName } from '../protocol/encoding';
import { SendQueue, type Diagnostic } from '../protocol/queue';
import { hex, type ParsedMessage } from '../protocol/sysex';
import { PATCH_NAME, PATCH_PARAMS, VARIATION_PARAMS } from '../model/params';
import { PatchImage, patchBlockAt, patchNameFrom, readRaw, readText } from '../model/patch';
import { RANGE_DEPENDENTS } from '../model/assigns';
import { isComplete, type BackupFile, type BlockBytes, type PatchFile } from '../storage/format';
import { patchFileFrom, readBackup, type FileMeta } from './backup';
import { effectiveRange, encodingSize, writable, type ParamDef } from '../model/schema';

export const ECHO_GUARD_MS = 300;
export const PATCH_CHANGE_QUIET_MS = 100;
export const PATCH_CHANGE_MAX_WAIT_MS = 300;
export const LOG_LIMIT = 1000;
/** Wait for the acknowledgement of PATCH_WRITE (measured: about 2 ms, protocol-notes 2.15). */
export const SAVE_ACK_TIMEOUT_MS = 2000;
/** How long loading a patch waits for the channel switch and its reads. */
export const LOAD_SWITCH_TIMEOUT_MS = 3000;

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
  /** Written as whole raw blocks (revert all, restore); undo() writes the same way. */
  readonly wholeBlocks: boolean;
}

/**
 * Outcome of saving (rule 10). `saved`: acknowledged and the slot read back equals the patch at the time of
 * saving. `mismatch`: the slot differs in these blocks (keys). `no-ack`: the amp did not acknowledge within
 * SAVE_ACK_TIMEOUT_MS. `unchecked`: acknowledged, but the slot could not be read back. `aborted`: channel change
 * or amp unplugged while saving. `refused`: saving is not possible right now (nothing was sent).
 */
export type SaveResult =
  | { readonly kind: 'saved'; readonly index: number }
  | { readonly kind: 'mismatch'; readonly index: number; readonly blocks: readonly string[] }
  | { readonly kind: 'no-ack' | 'unchecked' | 'aborted'; readonly index: number }
  | { readonly kind: 'refused' };

/**
 * Outcome of loading a patch from a file into a channel (PLAN 1c: restore). `loaded`: every writable block was
 * written into the current patch and read back as written; nothing is saved yet. `mismatch`: these blocks read
 * back differently. `aborted`: channel change, cable or timeout while loading. `refused`: not possible now or
 * the patch is incomplete (nothing was written).
 */
export type LoadResult =
  | { readonly kind: 'loaded'; readonly index: number; readonly written: number }
  | { readonly kind: 'mismatch'; readonly index: number; readonly blocks: readonly string[] }
  | { readonly kind: 'aborted'; readonly index: number }
  | { readonly kind: 'refused' };

/** Every writable parameter by each of its byte offsets (PLAN 4.4: only addresses from our list are written). */
const WRITABLE_AT: ReadonlyMap<Address, ParamDef> = new Map(
  [...PATCH_PARAMS, ...VARIATION_PARAMS]
    .filter(writable)
    .flatMap((p) => Array.from({ length: encodingSize(p.encoding) }, (_, i) => [p.at + i, p] as const)),
);

/** Patch parameters by key (for rangeBy: the target a min/max follows). */
const PATCH_PARAM_BY_KEY: ReadonlyMap<string, ParamDef> = new Map(
  PATCH_PARAMS.map((p) => [p.key, p] as const),
);

/** Raw value of a numeric parameter as bytes. */
function encodeValue(def: ParamDef, v: number): number[] {
  return def.encoding === 'u4x4' ? u4x4.encode(v) : u7.encode(v);
}

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
  /**
   * SYSTEM (Phase 3): settings of the whole amp, read once after connecting and again on return to the
   * foreground. The amp stores a write at once (protocol-notes 2.6), so there is no "unsaved" here.
   */
  readonly system: PatchImage;
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
  /** True while saving onto the channel (writes are locked). */
  readonly saving: boolean;
  /** True while a patch from a file is loaded into the current patch (writes are locked). */
  readonly loading: boolean;
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
  system: PatchImage.EMPTY_SYSTEM,
  stored: PatchImage.EMPTY,
  storedIndex: null,
  unsaved: [],
  unsavedKnown: false,
  remembered: new Map(),
  reading: false,
  lastReadAt: null,
  backingUp: false,
  saving: false,
  loading: false,
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
  /** Last own write per SYSTEM offset (rule 2 for SYSTEM). */
  private readonly lastSystemWrite = new Map<Address, number>();
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
  /** The acknowledgement of PATCH_WRITE being waited for (rule 10). */
  private saveAck: { readonly index: number; readonly settle: (ok: boolean) => void } | undefined;

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
        system: PatchImage.EMPTY_SYSTEM,
      });
      await this.readCurrent();
      await this.readSystem();
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
    void this.readCurrent().then(() => this.readSystem());
  }

  /** Reads SYSTEM (one range request, 21 blocks); a failure is logged, the old values stay. */
  async readSystem(): Promise<void> {
    const queue = this.queue;
    if (!queue || this.stateValue.phase !== 'connected') return;
    try {
      const reply = await queue.read(ADDR.system, SIZE.system);
      const image = PatchImage.system(reply.blocks, ADDR.system);
      if (!image.complete) {
        this.addLog('warn', `SYSTEM read incomplete: ${image.size} of 21 blocks`);
        return;
      }
      this.update({ system: image });
    } catch (error) {
      if (!isCancelled(error)) this.addLog('warn', `Reading SYSTEM failed: ${describe(error)}`);
    }
  }

  /**
   * Writes a SYSTEM parameter (raw, clamped to its range). Only confirmed parameters (status C), only once SYSTEM
   * has been read; the amp keeps the value at once, for every channel (protocol-notes 2.6).
   */
  async setSystemValue(def: ParamDef, raw: number): Promise<void> {
    const queue = this.queue;
    if (!queue || !this.canWrite() || !writable(def) || !this.stateValue.system.complete) return;
    const v = Math.min(def.max, Math.max(def.min, Math.round(raw)));
    const data = encodeValue(def, v);
    const now = this.now();
    data.forEach((_, i) => this.lastSystemWrite.set(def.at + i, now));
    this.update({ system: this.stateValue.system.with(def.at, data) });
    try {
      await queue.write(ADDR.system + def.at, data);
    } catch (error) {
      if (!isCancelled(error)) this.addLog('error', `Write failed: ${describe(error)}`);
    }
  }

  /**
   * Writes a parameter of the current patch (raw value, clamped to its range). Shown at once (rule 1). Refused
   * while reading, read-only, disconnected, and for parameters that are not writable (read-only, or the
   * address not yet confirmed on the amp). Parameters of a variation go through instanceParam().
   */
  async setValue(def: ParamDef, raw: number): Promise<void> {
    if (!this.canWrite() || !writable(def) || def.encoding === 'ascii16') return;
    const current = this.stateValue.current;
    const valueOf = (key: string): number | undefined => {
      const d = PATCH_PARAM_BY_KEY.get(key);
      return d && readRaw(current, d);
    };
    // Assign min/max: clamp to the range of the target (the amp stores anything, protocol-notes 2.8).
    const range = effectiveRange(def, valueOf);
    const v = Math.min(range.max, Math.max(range.min, Math.round(raw)));
    const runs = [{ offset: def.at, data: encodeValue(def, v) }];
    // A new assign target: min/max go to its full range, as in BOSS Tone Studio (the amp keeps them).
    for (const dep of RANGE_DEPENDENTS.get(def.key) ?? []) {
      if (!writable(dep)) continue;
      const r = effectiveRange(dep, (k) => (k === def.key ? v : valueOf(k)));
      runs.push({ offset: dep.at, data: encodeValue(dep, dep.key.endsWith('.min') ? r.min : r.max) });
    }
    await this.writeRuns(runs);
  }

  /** True while writes are allowed: connected, not read-only, not reading, no backup or save running. */
  canWrite(): boolean {
    const s = this.stateValue;
    return (
      this.queue !== undefined &&
      s.phase === 'connected' &&
      !s.readOnly &&
      !s.reading &&
      !s.backingUp &&
      !s.saving &&
      !s.loading &&
      s.current.complete
    );
  }

  /**
   * Writes single bytes of the current patch (reset, undo). Each byte goes out with its whole parameter, one DT1
   * per parameter (same address and length as a knob write, so the queue's coalescing stays consistent). Bytes
   * no writable parameter covers are skipped and counted (PLAN 4.4). With `wholeBlocks`, each byte goes out
   * with its whole block instead (revert all, restore: the bytes come from the amp's own stored slot or from
   * what the amp reported, so bytes outside our list may be written too); only the two read-only blocks are
   * skipped. Returns null when writing is not allowed right now.
   */
  async writeBytes(changes: readonly ByteChange[], wholeBlocks = false): Promise<WriteResult | null> {
    if (!this.canWrite()) return null;
    const s = this.stateValue;
    const generation = this.patchGeneration;
    /** The unit a byte is written with: its parameter or its block (offset and length). */
    const unitOf = (offset: Address): { at: Address; length: number } | undefined => {
      if (wholeBlocks) {
        const b = patchBlockAt(offset);
        return b && !READ_ONLY_PATCH_OFFSETS.has(b.offset) ? { at: b.offset, length: b.length } : undefined;
      }
      const def = writableParamAt(offset);
      return def && { at: def.at, length: encodingSize(def.encoding) };
    };
    const target = new Map<Address, number>();
    let skipped = 0;
    for (const c of changes) {
      if (!unitOf(c.offset) || !Number.isInteger(c.value) || c.value < 0 || c.value > 0x7f) skipped++;
      else target.set(c.offset, c.value);
    }
    const previous: ByteChange[] = [];
    const runs = new Map<Address, number[]>();
    for (const [offset, value] of [...target].sort((x, y) => x[0] - y[0])) {
      const old = s.current.read(offset, 1)?.[0];
      if (old === undefined || old === value) continue;
      previous.push({ offset, value: old });
      const unit = unitOf(offset);
      if (!unit) continue;
      const run = runs.get(unit.at) ?? [...(s.current.read(unit.at, unit.length) ?? [])];
      run[offset - unit.at] = value;
      runs.set(unit.at, run);
    }
    await this.writeRuns([...runs].map(([offset, data]) => ({ offset, data })));
    return { previous, skipped, generation, wholeBlocks };
  }

  /**
   * Renames the current patch (PLAN 1c): writes the name block (16 bytes, cleaned by patchNameFrom). Shown at
   * once, unsaved until saved; a double tap or "Revert all" brings the stored name back. Returns the name
   * written, or null when writing is not allowed.
   */
  async setName(text: string): Promise<string | null> {
    if (!this.canWrite()) return null;
    const name = patchNameFrom(text);
    await this.writeRuns([{ offset: PATCH_NAME.at, data: patchName.encode(name) }]);
    return name;
  }

  /**
   * Loads a patch from a file into a channel (PLAN 1c: restore; never directly into a stored slot, that is
   * Phase 4). Switches to the channel if needed (unsaved changes there are remembered as usual), keeps the
   * unsaved changes of the target as remembered changes, writes every writable block that differs as a whole
   * block (read-only blocks never), reads the current patch back and compares. Nothing is saved: the user
   * listens first and then saves the usual way.
   */
  async loadPatch(blocks: BlockBytes, index: number): Promise<LoadResult> {
    if (!this.canWrite() || this.patchChangePending()) return { kind: 'refused' };
    if (!(SELECTABLE_CHANNELS as readonly number[]).includes(index)) return { kind: 'refused' };
    if (!isComplete(blocks, PATCH_BLOCKS)) return { kind: 'refused' };
    const name = slotName(index);
    this.addLog('info', `Loading a patch from a file into ${name}`);
    if (index !== this.stateValue.patchIndex) {
      if (!(await this.selectChannel(index))) return { kind: 'refused' };
      const ready = await this.waitForState(
        (s) =>
          s.patchIndex === index &&
          !s.reading &&
          s.current.complete &&
          s.unsavedKnown &&
          !this.patchChangePending(),
        LOAD_SWITCH_TIMEOUT_MS,
      );
      if (!ready || !this.canWrite()) {
        this.addLog('error', `Loading into ${name} aborted: the channel did not switch`);
        return { kind: 'aborted', index };
      }
    }
    const queue = this.queue;
    if (!queue) return { kind: 'aborted', index };
    const generation = this.patchGeneration;
    this.rememberUnsaved(index);
    this.update({ loading: true });
    try {
      const runs = WRITABLE_PATCH_BLOCKS.flatMap((b) => {
        const data = blocks.get(b.key);
        const now = this.stateValue.current.block(b.offset);
        return data && !sameList(data, now ?? []) ? [{ offset: b.offset, data }] : [];
      });
      await this.writeRuns(runs);
      if (generation !== this.patchGeneration) return this.loadAborted(index);
      const reply = await queue.read(ADDR.currentPatch, SIZE.patch);
      if (generation !== this.patchGeneration) return this.loadAborted(index);
      const image = PatchImage.fromReply(reply.blocks, ADDR.currentPatch);
      if (image.complete) {
        this.update({ current: image, patchName: readText(image, PATCH_NAME) ?? null });
        this.updateUnsaved();
      }
      const differ = WRITABLE_PATCH_BLOCKS.filter(
        (b) => !sameList(image.block(b.offset) ?? [], blocks.get(b.key) ?? []),
      ).map((b) => b.key);
      if (differ.length > 0) {
        this.addLog(
          'error',
          `Loaded into ${name}, but ${differ.length} block(s) read back differently: ${differ.join(', ')}`,
        );
        return { kind: 'mismatch', index, blocks: differ };
      }
      this.addLog(
        'info',
        `Loaded into ${name}: ${runs.length} block(s) written, read back as written; not saved yet`,
      );
      return { kind: 'loaded', index, written: runs.length };
    } catch (error) {
      if (!isCancelled(error)) this.addLog('error', `Loading into ${name}: ${describe(error)}`);
      return this.loadAborted(index);
    } finally {
      this.update({ loading: false });
    }
  }

  /** Double tap on a knob (rule 7): the parameter goes back to the stored value of the channel. */
  async revertParam(def: ParamDef): Promise<WriteResult | null> {
    const s = this.stateValue;
    if (!s.unsavedKnown) return null;
    const stored = s.stored.read(def.at, encodingSize(def.encoding));
    if (!stored) return null;
    return this.writeBytes(stored.map((value, i) => ({ offset: def.at + i, value })));
  }

  /**
   * "Revert all" (rule 7): every byte that differs from the stored slot goes back to the stored value, as whole
   * blocks, so bytes outside our parameter list go back too (decided 2026-11-17; the read-only blocks are
   * never written).
   */
  async revertAll(): Promise<WriteResult | null> {
    const s = this.stateValue;
    if (!s.unsavedKnown) return null;
    return this.writeBytes(
      s.unsaved.map((offset) => ({ offset, value: s.stored.read(offset, 1)?.[0] ?? -1 })),
      true,
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
    const result = await this.writeBytes(changes, true);
    if (result) {
      this.discardRemembered(index);
      this.addLog('info', `Restored ${result.previous.length} remembered bytes of ${slotName(index)}`);
    }
    return result;
  }

  /** Undo of a reset, revert or restore: writes the previous values back, unless the patch changed since. */
  async undo(result: WriteResult): Promise<WriteResult | null> {
    if (result.generation !== this.patchGeneration || this.patchChangePending()) return null;
    return this.writeBytes(result.previous, result.wholeBlocks);
  }

  /**
   * Saves the current patch onto its channel (rule 10), only after the user confirmed it. A1–B4 only, never the
   * Panel or PREVIEW (the queue refuses those too). Locks writing, sends PATCH_WRITE with the channel's index,
   * waits for the acknowledgement, reads the slot back and compares all 80 blocks with the patch as it was when
   * saving started. The second acknowledgement the amp sends is ignored.
   */
  async save(): Promise<SaveResult> {
    const queue = this.queue;
    const s = this.stateValue;
    const index = s.patchIndex;
    if (
      !queue ||
      !this.canWrite() ||
      this.patchChangePending() ||
      index === null ||
      !(SELECTABLE_CHANNELS as readonly number[]).includes(index)
    )
      return { kind: 'refused' };
    const generation = this.patchGeneration;
    const snapshot = s.current;
    const name = slotName(index);
    this.update({ saving: true });
    this.addLog('info', `Saving onto ${name}`);
    const done = (result: SaveResult): SaveResult => {
      const text = {
        saved: `Saved onto ${name} and checked: identical`,
        mismatch: `Saved onto ${name}, but the slot differs${
          result.kind === 'mismatch'
            ? ` in ${result.blocks.length} block(s): ${result.blocks.join(', ')}`
            : ''
        }`,
        'no-ack': `Saving onto ${name}: no acknowledgement from the amp`,
        unchecked: `Saved onto ${name}, but reading it back failed`,
        aborted: `Saving onto ${name} aborted (channel change or amp unplugged)`,
        refused: '',
      }[result.kind];
      this.addLog(result.kind === 'saved' ? 'info' : 'error', text);
      return result;
    };
    try {
      const ack = this.waitForSaveAck(index);
      try {
        await queue.write(ADDR.patchWrite, u2x4.encode(index), { allowPatchWrite: true });
      } catch (error) {
        this.saveAck?.settle(false);
        throw error;
      }
      const acknowledged = await ack;
      if (generation !== this.patchGeneration || this.queue !== queue)
        return done({ kind: 'aborted', index });
      if (!acknowledged) {
        void this.readStored(index); // so "unsaved" shows what the slot holds now
        return done({ kind: 'no-ack', index });
      }
      this.discardRemembered(index);
      this.storedGeneration++; // a background read of the slot is void
      this.storedCollector = undefined;
      const base = storedPatchAddress(index);
      const reply = await queue.read(base, SIZE.patch);
      if (generation !== this.patchGeneration) return done({ kind: 'aborted', index });
      const slot = PatchImage.fromReply(reply.blocks, base);
      if (!slot.complete) return done({ kind: 'unchecked', index });
      this.update({ stored: slot, storedIndex: index });
      this.updateUnsaved();
      const blocks = [...new Set(snapshot.diff(slot).map((o) => blockKey(patchBlockAt(o)?.offset ?? o)))];
      return done(blocks.length > 0 ? { kind: 'mismatch', index, blocks } : { kind: 'saved', index });
    } catch (error) {
      if (isCancelled(error) || generation !== this.patchGeneration) return done({ kind: 'aborted', index });
      this.addLog('error', `Saving onto ${name}: ${describe(error)}`);
      return done({ kind: 'unchecked', index });
    } finally {
      this.update({ saving: false });
    }
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

  private loadAborted(index: number): LoadResult {
    this.addLog('error', `Loading into ${slotName(index)} aborted (channel change or amp unplugged)`);
    return { kind: 'aborted', index };
  }

  /** Resolves true once the state satisfies `ok`, false after `ms`. */
  private waitForState(ok: (s: ConnectionState) => boolean, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (ok(this.stateValue)) return resolve(true);
      const listener = (s: ConnectionState): void => {
        if (!ok(s)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        resolve(false);
      }, ms);
      this.listeners.add(listener);
    });
  }

  /** Keeps the unsaved changes of the current channel as remembered changes (before loading over them). */
  private rememberUnsaved(index: number): void {
    const s = this.stateValue;
    if (!s.unsavedKnown || s.unsaved.length === 0) return;
    const changes = s.unsaved.map((offset) => ({ offset, value: s.current.read(offset, 1)?.[0] ?? 0 }));
    const remembered = new Map(s.remembered);
    remembered.set(index, changes);
    this.update({ remembered });
    this.addLog('info', `Remembered ${changes.length} unsaved bytes of ${slotName(index)} before loading`);
  }

  /** Resolves true on the acknowledgement of PATCH_WRITE for `index`, false on timeout, unplug or patch change. */
  private waitForSaveAck(index: number): Promise<boolean> {
    this.saveAck?.settle(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.saveAck?.settle(false), SAVE_ACK_TIMEOUT_MS);
      this.saveAck = {
        index,
        settle: (ok) => {
          clearTimeout(timer);
          this.saveAck = undefined;
          resolve(ok);
        },
      };
    });
  }

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
    this.update({ current, patchName: readText(current, PATCH_NAME) ?? null });
    this.updateUnsaved();
    try {
      await Promise.all(runs.map((r) => queue.write(ADDR.currentPatch + r.offset, r.data)));
      stamp();
    } catch (error) {
      if (!isCancelled(error)) this.addLog('error', `Write failed: ${describe(error)}`);
      return;
    }
    // Bytes the amp changes along with a written parameter (alsoChanges, e.g. layer mode and the Delay 2
    // switch): read back, the reply comes in like a report and is applied by onMessage.
    const written = new Set(runs.flatMap((r) => r.data.map((_, i) => r.offset + i)));
    const coupled = new Set<Address>();
    for (const at of written)
      for (const c of writableParamAt(at)?.alsoChanges ?? []) if (!written.has(c)) coupled.add(c);
    for (const c of coupled) {
      queue.readBytes(ADDR.currentPatch + c, 1).catch((error: unknown) => {
        if (!isCancelled(error))
          this.addLog('warn', `Reading back a coupled byte failed: ${describe(error)}`);
      });
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
        this.saveAck?.settle(false);
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
      const index = m.data.length === 2 ? u2x4.decode([...m.data]) : null;
      if (this.saveAck && index === this.saveAck.index) this.saveAck.settle(true);
      else if (!this.stateValue.saving) this.onSaved(m.data); // during our save: its second acknowledgement
      return;
    }
    const sysOffset = m.address - ADDR.system;
    if (sysOffset >= 0 && sysOffset < SIZE.system) {
      // SYSTEM changed on the amp (or the reply of our read): applied except under the write guard (rule 2).
      const system = this.stateValue.system;
      const now = this.now();
      const data = m.data.map((v, i) => {
        const guardedUntil = (this.lastSystemWrite.get(sysOffset + i) ?? -Infinity) + ECHO_GUARD_MS;
        return now < guardedUntil ? (system.read(sysOffset + i, 1)?.[0] ?? v) : v;
      });
      const next = system.with(sysOffset, data);
      if (next !== system) this.update({ system: next });
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
    this.saveAck?.settle(false);
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
