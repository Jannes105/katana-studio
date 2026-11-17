// Mock amp (PLAN 4.7): a simulated Katana 100 Gen 3 behind the Transport interface, for development and tests
// without the amp. It follows what protocol-notes.md says the real amp does:
//
// - identity reply with device ID 10 and model code 06
// - RQ1 over a range: one DT1 per block, gaps skipped, ascending (2.11); a single read inside a block: the
//   requested bytes; the command area answers single reads only (2.9); unknown addresses: no reply
// - DT1 parameter writes are stored without echo and without acknowledgement (2.13)
// - reports only with editor mode on (Q8): PATCH_SELECT burst (Q6), channel change, knob and save on the amp
//   (Q1–Q3)
// - PATCH_WRITE from the app: acknowledged twice at 7F 00 01 04, then the status bytes (2.15); faults for
//   testing the app's checks can be switched on (saveFault)
//
// It only mirrors our assumptions, so tests against real captures (replay.ts) stay necessary (PLAN 4.7).

import type { MessageListener, MidiMessage, Transport } from '../midi/transport';
import {
  ADDR,
  PANEL_INDEX,
  PREVIEW_INDEX,
  addr,
  storedPatchAddress,
  type Address,
} from '../protocol/address';
import { KNOWN_AREAS, PATCH_BLOCKS } from '../protocol/blocks';
import { patchName, u2x4 } from '../protocol/encoding';
import { IDENTITY_REQUEST, buildDt1, parseMessage } from '../protocol/sysex';
import { DEMO_PATCHES, writeDemoPatch } from './demo-patches';

export const MOCK_DEVICE_ID = 0x10;
export const MOCK_IDENTITY_REPLY: readonly number[] = [
  0xf0,
  0x7e,
  MOCK_DEVICE_ID,
  0x06,
  0x02,
  0x41,
  0x07,
  0x05,
  0x00,
  0x00,
  0x06,
  0x00,
  0x00,
  0x00,
  0xf7,
];

/** Offsets inside a patch the mock needs to know (protocol-notes 2.8). */
const OFFSET_COLOURS = addr(0, 0, 0x04, 0x00); // 5 bytes: BOOSTER, MOD, FX, DELAY, REVERB colour 0–2
const OFFSET_SWITCHES = addr(0, 0, 0x08, 0x00); // 6 bytes: on/off; byte 4 is Delay 2
/** Switch byte of each of the five effects (reverb sits at 5, not 4). */
const SWITCH_INDEX = [0, 1, 2, 3, 5] as const;

/** SYSTEM factory values, one row per block (21 blocks, protocol-notes 2.6/2.12). */
const PEQ_FLAT = [0, 20, 14, 1, 20, 23, 1, 20, 20, 14, 20];
const GEQ_FLAT = new Array<number>(11).fill(24);
const SYSTEM_FACTORY: readonly (readonly number[])[] = [
  [0], // stereo expand
  [20, 50, 25, 0, 50], // USB
  [0, 0], // global EQ off, memory 1
  [0, 0],
  [0, 0],
  [0, 0],
  PEQ_FLAT,
  PEQ_FLAT,
  PEQ_FLAT,
  GEQ_FLAT,
  GEQ_FLAT,
  GEQ_FLAT,
  [0, 0, 0], // line out
  [2, 2, 2, 0, 0],
  [2, 2, 2, 0, 0],
  [0, 0, 20], // power amp in
  [4], // power control
  [6, 1, 2, 4, 5], // GA-FC function mode
  [0], // MIDI channel 1
  [15, 16, 17, 18, 19, 20, 47, 48, 49, 52, 50, 51, 56, 53, 54, 55, 57, 58, 59],
  [4, 0, 1, 2, 3, 5, 6, 7, 8],
];

/** Simulated faults of PATCH_WRITE from the app (PLAN 5, 1c: a simulated fault must show a message). */
export type SaveFault = 'none' | 'no-ack' | 'wrong-content';

export interface MockAmpOptions {
  /** Delay before the first message of a reply or report burst (real amp: about 3–5 ms). */
  readonly replyDelayMs?: number;
  /** Delay between further messages of the same reply (real amp: 0.27 s for 80 blocks ≈ 3 ms). */
  readonly messageGapMs?: number;
  /** Model code in the identity reply (06 = KATANA-100). */
  readonly modelCode?: number;
  /** Editor level at 7F 00 00 00 (1 on the real amp). */
  readonly editorLevel?: number;
  /**
   * Memory content: 'neutral' (default, for tests: names "MOCK n", all amp knobs 50, NS threshold 40) or
   * 'demo' (invented patches with different amp types and effects, for trying the UI; demo-patches.ts).
   */
  readonly content?: 'neutral' | 'demo';
}

/** One block of memory: area base + block offset, with its bytes. */
interface MemoryBlock {
  readonly address: Address;
  readonly data: number[];
}

export class MockAmp implements Transport {
  private readonly listeners = new Set<MessageListener>();
  private readonly blocks: MemoryBlock[] = [];
  private readonly replyDelayMs: number;
  private readonly messageGapMs: number;
  private readonly modelCode: number;
  private readonly editorLevel: number;
  /** Time at which the next outgoing message may be scheduled (keeps replies in order). */
  private nextSendAt = 0;

  patchNumber = 1;
  editorMode = 0;
  /** When true, the amp answers nothing (cable pulled without detach, broken amp). */
  silent = false;
  /**
   * PATCH_WRITE from the app: 'no-ack' saves nothing and stays silent, 'wrong-content' saves, acknowledges, but
   * one byte of the slot (NS threshold) ends up different.
   */
  saveFault: SaveFault = 'none';
  /** Every message the mock received, for assertions. */
  readonly received: MidiMessage[] = [];

  constructor(options: MockAmpOptions = {}) {
    this.replyDelayMs = options.replyDelayMs ?? 4;
    this.messageGapMs = options.messageGapMs ?? 3;
    this.modelCode = options.modelCode ?? 0x06;
    this.editorLevel = options.editorLevel ?? 1;

    for (const area of KNOWN_AREAS) {
      for (const b of area.blocks)
        this.blocks.push({ address: area.base + b.offset, data: new Array<number>(b.length).fill(0) });
    }
    this.blocks.push({ address: ADDR.patchNumber, data: [0, 0] });
    this.blocks.sort((a, b) => a.address - b.address);

    // Neutral or invented content: no real patch data in the repository.
    for (let i = 0; i <= PREVIEW_INDEX; i++) {
      const base = storedPatchAddress(i);
      const demo = DEMO_PATCHES[i];
      if (options.content === 'demo' && demo) {
        writeDemoPatch((a, d) => this.poke(a, d), base, demo);
        continue;
      }
      const name = i === PANEL_INDEX ? 'PANEL' : i === PREVIEW_INDEX ? 'PREVIEW' : `MOCK ${i}`;
      this.poke(base, patchName.encode(name));
      this.poke(base + addr(0, 0, 0x06, 0x00), [50, 50, 50, 50, 50, 50]); // amp knobs
      this.poke(base + OFFSET_SWITCHES, [1, 0, 0, 1, 0, 1]);
      this.poke(base + addr(0, 0, 0x58, 0x00), [1, 40, 30]); // NS on, threshold, release
    }
    this.copyPatch(storedPatchAddress(this.patchNumber), ADDR.currentPatch);
    this.poke(ADDR.patchNumber, u2x4.encode(this.patchNumber));
    // SYSTEM at the factory values (protocol-notes 2.6), so the system pages show something plausible.
    SYSTEM_FACTORY.forEach((data, i) => this.poke(ADDR.system + i * addr(0, 0, 0x02, 0), data));
  }

  // ---- Transport ----

  send(message: MidiMessage): Promise<void> {
    this.received.push(message);
    this.handle(message);
    return Promise.resolve();
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- direct memory access for tests ----

  /** Reads `length` bytes from memory; undefined if the address is not in a block. */
  peek(address: Address, length = 1): number[] | undefined {
    const found = this.blockContaining(address);
    if (!found) return undefined;
    const start = address - found.address;
    return found.data.slice(start, start + length);
  }

  /** Writes bytes into memory (within one block), without any message. */
  poke(address: Address, data: readonly number[]): void {
    const found = this.blockContaining(address);
    if (!found) throw new RangeError(`No memory at ${address}`);
    const start = address - found.address;
    if (start + data.length > found.data.length) throw new RangeError('Write crosses a block boundary');
    found.data.splice(start, data.length, ...data);
  }

  // ---- actions on the amp itself (reported only with editor mode on) ----

  /** Turns a knob: stores the value and reports it like the real amp (one DT1 per value). */
  turnKnob(address: Address, value: number): void {
    this.poke(address, [value]);
    if (this.editorMode) this.emit([this.dt1(address, [value])]);
  }

  /** Presses a channel button on the amp (Q1): status bytes twice, then the patch number. */
  selectChannelOnAmp(index: number): void {
    this.loadPatch(index);
    if (!this.editorMode) return;
    const extra = index === PANEL_INDEX ? [this.dt1(addr(0x30, 0x00, 0x02, 0x00), [0, 0, 0, 0, 0])] : [];
    this.emit([...this.statusBytes(5), ...this.statusBytes(4), ...extra, this.patchNumberReport()]);
  }

  /** Holds the channel button to save (Q2): copies the current patch into its slot. */
  saveOnAmp(): void {
    this.storePatch(this.patchNumber);
    if (!this.editorMode) return;
    this.emit([
      this.dt1(ADDR.patchWrite, u2x4.encode(this.patchNumber)),
      ...this.statusBytes(5),
      ...this.statusBytes(4),
    ]);
  }

  /** Power cycle: editor mode is off afterwards (Q8). */
  powerCycle(): void {
    this.editorMode = 0;
  }

  // ---- internals ----

  private handle(message: MidiMessage): void {
    if (this.silent) return;
    if (message.length === IDENTITY_REQUEST.length && message.every((b, i) => b === IDENTITY_REQUEST[i])) {
      const reply = [...MOCK_IDENTITY_REPLY];
      reply[10] = this.modelCode;
      this.emit([reply]);
      return;
    }
    const m = parseMessage(message);
    if ((m.type !== 'rq1' && m.type !== 'dt1') || !m.checksumOk) return;
    if (m.deviceId !== MOCK_DEVICE_ID && m.deviceId !== 0x7f) return;
    if (m.type === 'rq1') this.answerRead(m.address, m.size);
    else this.applyWrite(m.address, m.data);
  }

  private answerRead(address: Address, size: number): void {
    // Command area: single reads only (protocol-notes 2.9).
    if (address >= ADDR.editorLevel) {
      const value = this.commandValue(address);
      if (size === 1 && value !== undefined) this.emit([this.dt1(address, [value])]);
      return;
    }
    const end = address + size;
    const out: number[][] = [];
    for (const b of this.blocks) {
      const blockEnd = b.address + b.data.length;
      if (blockEnd <= address || b.address >= end) continue;
      const from = Math.max(address, b.address);
      const to = Math.min(end, blockEnd);
      out.push(this.dt1(from, b.data.slice(from - b.address, to - b.address)));
    }
    this.emit(out);
  }

  private commandValue(address: Address): number | undefined {
    switch (address) {
      case ADDR.editorLevel:
        return this.editorLevel;
      case ADDR.editorMode:
        return this.editorMode;
      case ADDR.editorMode + 1: // running mode
        return 1;
      case ADDR.editorMode + 2: // revision
        return 0;
      default:
        return undefined;
    }
  }

  private applyWrite(address: Address, data: readonly number[]): void {
    if (address === ADDR.editorMode) {
      this.editorMode = data[0] ?? 0;
      return; // not acknowledged
    }
    if (address === ADDR.patchSelect) {
      const index = u2x4.decode(data.slice(0, 2));
      const same = index === this.patchNumber;
      this.loadPatch(index);
      if (!this.editorMode) return;
      // Q6: echo, patch number, status bytes 5 + 4, patch number again (not when selecting the active one).
      const burst = [
        this.dt1(ADDR.patchSelect, data),
        this.patchNumberReport(),
        ...this.statusBytes(5),
        ...this.statusBytes(4),
      ];
      if (!same) burst.push(this.patchNumberReport());
      this.emit(burst);
      return;
    }
    if (address === ADDR.patchWrite) {
      const index = u2x4.decode(data.slice(0, 2));
      if (index === PANEL_INDEX || index === PREVIEW_INDEX) return;
      if (this.saveFault === 'no-ack') return;
      this.storePatch(index);
      if (this.saveFault === 'wrong-content') {
        const ns = storedPatchAddress(index) + addr(0, 0, 0x58, 0x01);
        this.poke(ns, [((this.peek(ns, 1)?.[0] ?? 0) + 1) % 101]);
      }
      // protocol-notes 2.15: acknowledged twice at the same address, then the status bytes.
      if (this.editorMode) {
        const ack = this.dt1(ADDR.patchWrite, data);
        this.emit([ack, ack, ...this.statusBytes(5), ...this.statusBytes(4)]);
      }
      return;
    }
    // Parameter write: stored silently, no echo (2.13). Unknown addresses are ignored.
    if (this.blockContaining(address)) {
      try {
        this.poke(address, data);
        if (data.length === 1) this.couple(address, data[0] ?? 0);
      } catch {
        // crosses a block boundary: the real amp's behaviour is unknown, the mock ignores it
      }
    }
  }

  /**
   * The amp keeps the Delay 2 switch and the layer mode of the active reverb variation consistent, silently
   * (measured 2026-11-17: switch 0 → 1 set layer mode 2 → 1, layer mode 2 → 1 set the switch 0 → 1; the other
   * directions are assumed to mirror that).
   */
  private couple(address: Address, value: number): void {
    const base = ADDR.currentPatch;
    const colour = this.peek(base + addr(0, 0, 0x04, 0x04), 1)?.[0] ?? 0;
    const layer = base + addr(0, 0, 0x34 + 2 * colour, 0x01);
    const delay2 = base + OFFSET_SWITCHES + 4;
    if (address === delay2) {
      const mode = this.peek(layer, 1)?.[0] ?? 2;
      if (value === 1 && mode === 2) this.poke(layer, [1]);
      if (value === 0 && mode !== 2) this.poke(layer, [2]);
    } else if (address === layer) {
      this.poke(delay2, [value === 2 ? 0 : 1]);
    }
  }

  private loadPatch(index: number): void {
    this.patchNumber = index;
    this.poke(ADDR.patchNumber, u2x4.encode(index));
    this.copyPatch(storedPatchAddress(index), ADDR.currentPatch);
  }

  private storePatch(index: number): void {
    this.copyPatch(ADDR.currentPatch, storedPatchAddress(index));
  }

  private copyPatch(from: Address, to: Address): void {
    for (const b of PATCH_BLOCKS) {
      const data = this.peek(from + b.offset, b.length);
      if (data) this.poke(to + b.offset, data);
    }
  }

  /** The first `count` status bytes 7F 01 01 01 …: colour 0–2 of an effect, 3 = off. */
  private statusBytes(count: number): number[][] {
    const colours = this.peek(ADDR.currentPatch + OFFSET_COLOURS, 5) ?? [];
    const switches = this.peek(ADDR.currentPatch + OFFSET_SWITCHES, 6) ?? [];
    return SWITCH_INDEX.slice(0, count).map((s, k) =>
      this.dt1(ADDR.effectStatus + k, [switches[s] ? (colours[k] ?? 0) : 3]),
    );
  }

  private patchNumberReport(): number[] {
    return this.dt1(ADDR.patchNumber, u2x4.encode(this.patchNumber));
  }

  private dt1(address: Address, data: readonly number[]): number[] {
    return buildDt1(MOCK_DEVICE_ID, address, data);
  }

  private blockContaining(address: Address): MemoryBlock | undefined {
    return this.blocks.find((b) => address >= b.address && address < b.address + b.data.length);
  }

  /** Schedules messages in order: first after replyDelayMs, then messageGapMs apart. */
  private emit(messages: readonly (readonly number[])[]): void {
    let at = Math.max(Date.now() + this.replyDelayMs, this.nextSendAt);
    for (const m of messages) {
      const due = at;
      setTimeout(() => {
        for (const l of this.listeners) l(m);
      }, due - Date.now());
      at += this.messageGapMs;
    }
    this.nextSendAt = at;
  }
}
