// Connection to the amp and the one parameter of Phase 0b (PLAN 5: "Connected, KATANA-100", read and write one
// parameter, log). Framework-free: the UI subscribes through the store contract (`subscribe` calls the
// listener at once and on every change), which Svelte understands directly.
//
// Rules from PLAN 4.5 that already apply here:
//  - the amp is the truth: a written value shows at once, then whatever the amp reports wins
//  - while a value is being written, and 300 ms after, incoming values for that address are ignored (rule 2)
//  - patch change (DT1 at 00 00 00 00): clear the queue, wait for 100 ms of quiet (at most 300 ms), read again
//  - after a restart or reconnect the app greets and reads, it never writes on its own (rule 8)
//  - a pulled cable is a normal state: values freeze, the app reconnects when the amp comes back (rule 9)

import type { DeviceEvent, DeviceTransport, Transport } from '../midi/transport';
import { ADDR, PATCH_SLOT_NAMES, addr, isPatchIndex, type Address } from '../protocol/address';
import { patchName, u2x4 } from '../protocol/encoding';
import { greet, modelName, type GreetingWarning } from '../protocol/greeting';
import { SendQueue, type Diagnostic } from '../protocol/queue';
import { hex, type ParsedMessage } from '../protocol/sysex';

/** The parameter of Phase 0b: noise suppressor threshold of the current patch (0–100, written audibly in 0a). */
export const NS_THRESHOLD: Address = ADDR.currentPatch + addr(0, 0, 0x58, 0x01);
export const NS_THRESHOLD_MIN = 0;
export const NS_THRESHOLD_MAX = 100;
const PATCH_NAME: Address = ADDR.currentPatch;

export const ECHO_GUARD_MS = 300;
export const PATCH_CHANGE_QUIET_MS = 100;
export const PATCH_CHANGE_MAX_WAIT_MS = 300;
export const LOG_LIMIT = 1000;

export type Phase = 'starting' | 'waiting' | 'connecting' | 'connected' | 'error';

export interface ConnectionState {
  readonly phase: Phase;
  readonly device: string;
  readonly model: string | null;
  readonly readOnly: boolean;
  readonly warnings: readonly GreetingWarning[];
  readonly error: string | null;
  readonly patchIndex: number | null;
  readonly patchName: string | null;
  readonly nsThreshold: number | null;
  /** True while the current patch is being read (controls are locked). */
  readonly reading: boolean;
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
  readOnly: false,
  warnings: [],
  error: null,
  patchIndex: null,
  patchName: null,
  nsThreshold: null,
  reading: false,
};

export function slotName(index: number | null): string {
  return index !== null && isPatchIndex(index) ? PATCH_SLOT_NAMES[index] : '–';
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
  private lastLocalWrite = new Map<Address, number>();
  private patchChangeTimer: ReturnType<typeof setTimeout> | undefined;
  private patchChangeSince = 0;
  private lastIncoming = 0;
  private readGeneration = 0;
  private ownPatchNumberReads = 0;

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

  /** Reads patch number, name and the NS threshold of the current patch. */
  async readCurrent(): Promise<void> {
    const queue = this.queue;
    if (!queue || this.stateValue.phase !== 'connected') return;
    const generation = ++this.readGeneration;
    const before = this.stateValue.patchIndex;
    this.update({ reading: true });
    try {
      // The reply to our own read of 00 00 00 00 looks exactly like the patch-change report. While this read
      // is open, a DT1 there is taken as the reply (its listener runs before the read resolves).
      this.ownPatchNumberReads++;
      const numberRead = queue.readBytes(ADDR.patchNumber, 2).finally(() => this.ownPatchNumberReads--);
      const [number, name, threshold] = await Promise.all([
        numberRead,
        queue.readBytes(PATCH_NAME, 16),
        queue.readBytes(NS_THRESHOLD, 1),
      ]);
      if (generation !== this.readGeneration) return; // a newer read took over
      const index = number.length === 2 ? u2x4.decode([...number]) : null;
      if (before !== null && index !== null && index !== before && !this.patchChangePending()) {
        // The channel changed while we were reading; name and value may belong to the old one.
        this.onPatchChange([...number]);
        return;
      }
      const nameText = name.length === 16 ? patchName.decode([...name]) : null;
      this.update({
        patchIndex: index,
        patchName: nameText,
        nsThreshold: threshold[0] ?? null,
        reading: false,
      });
      this.addLog(
        'info',
        `Read ${slotName(index)} "${nameText ?? '?'}": NS threshold ${threshold[0] ?? '?'}`,
      );
    } catch (error) {
      if (generation !== this.readGeneration) return;
      this.update({ reading: false });
      if (isCancelled(error)) return; // a patch change cleared the queue; a new read follows
      this.fail(error);
    }
  }

  /** Writes the NS threshold of the current patch (clamped to 0–100). */
  async setNsThreshold(value: number): Promise<void> {
    const queue = this.queue;
    const s = this.stateValue;
    if (!queue || s.phase !== 'connected' || s.readOnly || s.reading) return;
    const v = Math.min(NS_THRESHOLD_MAX, Math.max(NS_THRESHOLD_MIN, Math.round(value)));
    this.lastLocalWrite.set(NS_THRESHOLD, this.now());
    this.update({ nsThreshold: v }); // shown at once (rule 1)
    try {
      await queue.write(NS_THRESHOLD, [v]);
      this.lastLocalWrite.set(NS_THRESHOLD, this.now());
    } catch (error) {
      if (!isCancelled(error)) this.addLog('error', `Write failed: ${describe(error)}`);
    }
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
    // A report or reply that covers the NS threshold.
    const offset = NS_THRESHOLD - m.address;
    if (offset >= 0 && offset < m.data.length && !this.patchChangePending()) {
      const guardedUntil = (this.lastLocalWrite.get(NS_THRESHOLD) ?? -Infinity) + ECHO_GUARD_MS;
      if (this.now() >= guardedUntil) this.update({ nsThreshold: m.data[offset] ?? null });
    }
    const nameOffset = PATCH_NAME - m.address;
    if (nameOffset === 0 && m.data.length >= 16 && !this.patchChangePending()) {
      this.update({ patchName: patchName.decode([...m.data.slice(0, 16)]) });
    }
  }

  /** Rule 3 of PLAN 4.5. */
  private onPatchChange(data: readonly number[]): void {
    const index = data.length === 2 ? u2x4.decode([...data]) : null;
    this.addLog('info', `Patch change to ${slotName(index)}`);
    this.queue?.clear();
    this.readGeneration++; // a running read is void
    this.update({ patchIndex: index, reading: true });
    if (!this.patchChangePending()) this.patchChangeSince = this.now();
    clearTimeout(this.patchChangeTimer);
    this.schedulePatchRead();
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

function isCancelled(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'QueueCancelledError' || error.name === 'QueueClosedError')
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
