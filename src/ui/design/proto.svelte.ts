// Design prototype (Gestaltungsrunde, PLAN 5). Throwaway: it exists to try screen designs on the phone with the
// mock amp, not as the state layer of Phase 1.
//
// Connection, greeting, channel and log run through the real AmpConnection and the mock amp. The parameters the
// real state layer cannot handle yet (it only knows the NS threshold) are read from and written into the mock
// amp's memory directly. "Unsaved", remembered changes per channel (PLAN 2) and reset follow PLAN 4.5 in spirit.

import { fromStore } from 'svelte/store';
import { ADDR, addr, storedPatchAddress, type Address } from '../../protocol/address';
import type { MockAmp } from '../../mock/mock-amp';
import type { MockDevice } from '../../mock/mock-device';
import { slotName, type ConnectionState } from '../../state/connection';
import { createApp, type App } from '../setup';

export interface ParamDef {
  readonly key: string;
  readonly label: string;
  readonly group: 'amp' | 'ns';
  /** Offset inside the patch (protocol-notes 2.8). */
  readonly offset: Address;
}

const AMP = addr(0, 0, 0x06, 0x00);
const NS = addr(0, 0, 0x58, 0x00);
const SWITCHES = addr(0, 0, 0x08, 0x00);
const COLOURS = addr(0, 0, 0x04, 0x00);

export const PARAMS: readonly ParamDef[] = [
  { key: 'gain', label: 'Gain', group: 'amp', offset: AMP + 0 },
  { key: 'volume', label: 'Volume', group: 'amp', offset: AMP + 1 },
  { key: 'bass', label: 'Bass', group: 'amp', offset: AMP + 2 },
  { key: 'middle', label: 'Middle', group: 'amp', offset: AMP + 3 },
  { key: 'treble', label: 'Treble', group: 'amp', offset: AMP + 4 },
  { key: 'presence', label: 'Presence', group: 'amp', offset: AMP + 5 },
  { key: 'threshold', label: 'Threshold', group: 'ns', offset: NS + 1 },
  { key: 'release', label: 'Release', group: 'ns', offset: NS + 2 },
];

export const GROUP_TITLES = { amp: 'Amp', ns: 'Noise Suppressor' } as const;

/** The rest of the amp block 06 00 (protocol-notes 2.8: type at +7 [D]; the others from the same block). */
export const AMP_TYPE = AMP + 7;
export const AMP_TYPES = ['Acoustic', 'Clean', 'Pushed', 'Crunch', 'Lead', 'Brown'] as const;
export const PREAMP_VARIATION = AMP + 9;
export const POWERAMP_VARIATION = AMP + 6;
export const RESONANCE: ParamDef = { key: 'resonance', label: 'Resonance', group: 'amp', offset: AMP + 8 };

export interface EffectDef {
  readonly key: string;
  readonly label: string;
  readonly switchOffset: Address;
  /** Colour (variation 0–2) byte; null for effects without variations. */
  readonly colourOffset: Address | null;
}

export const EFFECTS: readonly EffectDef[] = [
  { key: 'booster', label: 'Booster', switchOffset: SWITCHES + 0, colourOffset: COLOURS + 0 },
  { key: 'mod', label: 'Mod', switchOffset: SWITCHES + 1, colourOffset: COLOURS + 1 },
  { key: 'fx', label: 'FX', switchOffset: SWITCHES + 2, colourOffset: COLOURS + 2 },
  { key: 'delay', label: 'Delay', switchOffset: SWITCHES + 3, colourOffset: COLOURS + 3 },
  { key: 'reverb', label: 'Reverb', switchOffset: SWITCHES + 5, colourOffset: COLOURS + 4 },
  { key: 'ns', label: 'Noise Suppressor', switchOffset: NS + 0, colourOffset: null },
];

const TRACKED: readonly Address[] = [
  ...PARAMS.map((p) => p.offset),
  AMP_TYPE,
  PREAMP_VARIATION,
  POWERAMP_VARIATION,
  RESONANCE.offset,
  ...EFFECTS.flatMap((e) => (e.colourOffset === null ? [e.switchOffset] : [e.switchOffset, e.colourOffset])),
];

const LABELS = new Map<Address, string>([
  ...PARAMS.map((p) => [p.offset, p.label] as const),
  [AMP_TYPE, 'Amp-Typ'],
  [PREAMP_VARIATION, 'Variation'],
  [POWERAMP_VARIATION, 'Endstufen-Variation'],
  [RESONANCE.offset, RESONANCE.label],
  ...EFFECTS.map((e) => [e.switchOffset, `${e.label} an/aus`] as const),
  ...EFFECTS.flatMap((e) => (e.colourOffset === null ? [] : [[e.colourOffset, `${e.label} Farbe`] as const])),
]);

export interface Diff {
  readonly offset: Address;
  readonly value: number;
}

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly undo?: () => void;
}

const POLL_MS = 120;
const GUARD_MS = 300;
const TOAST_MS = 4000;

export class Proto {
  readonly app: App;
  readonly mock: MockDevice;
  readonly amp: MockAmp;
  private readonly conn: { readonly current: ConnectionState };

  current = $state<Record<number, number>>({});
  stored = $state<Record<number, number>>({});
  /** Unsaved changes of channels that were left, per patch index (PLAN 2). */
  remembered = $state<Record<number, readonly Diff[]>>({});
  toast = $state<Toast | null>(null);
  fakeReadOnly = $state(false);
  readonly fx = new FxPlaceholders();
  /** Contour placeholder (not in our parameter list yet): 0 = off, 1–3; Freq Shift per contour, -50…+50. */
  contour = $state({ select: 0, shift: [0, 0, 0] });
  hasData = $state(false);
  failing = $state(false);

  private guardUntil: Record<number, number> = {};
  private pauseUntil = 0;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private toastId = 0;

  constructor() {
    this.app = createApp();
    if (!this.app.mock) throw new Error('The design prototype runs in the browser only');
    this.mock = this.app.mock;
    this.amp = this.mock.amp;
    // Some variety in the mock's neutral patches: different amp types and resonance per channel.
    for (let i = 0; i <= 8; i++) {
      const base = storedPatchAddress(i) + AMP;
      this.amp.poke(base + 7, [i % AMP_TYPES.length]);
      this.amp.poke(base + 8, [50]);
      this.amp.poke(base + 9, [i % 2]);
      if (i === this.amp.patchNumber) {
        this.amp.poke(ADDR.currentPatch + AMP + 7, [i % AMP_TYPES.length]);
        this.amp.poke(ADDR.currentPatch + AMP + 8, [50]);
        this.amp.poke(ADDR.currentPatch + AMP + 9, [i % 2]);
      }
    }
    this.conn = fromStore(this.app.connection);
    setInterval(() => this.poll(), POLL_MS);
  }

  start(): void {
    void this.app.connection.start();
  }

  get s(): ConnectionState {
    return this.conn.current;
  }

  get slot(): string {
    return slotName(this.s.patchIndex);
  }

  get canWrite(): boolean {
    const s = this.s;
    return s.phase === 'connected' && !s.reading && !s.readOnly && !this.fakeReadOnly && this.hasData;
  }

  get readOnly(): boolean {
    return this.s.readOnly || this.fakeReadOnly;
  }

  get unsavedOffsets(): Address[] {
    return this.hasData ? TRACKED.filter((o) => this.current[o] !== this.stored[o]) : [];
  }

  get unsaved(): boolean {
    return this.unsavedOffsets.length > 0;
  }

  value(offset: Address): number {
    return this.current[offset] ?? 0;
  }

  storedValue(offset: Address): number {
    return this.stored[offset] ?? 0;
  }

  changed(offset: Address): boolean {
    return this.hasData && this.current[offset] !== this.stored[offset];
  }

  rememberedHere(): readonly Diff[] {
    const i = this.s.patchIndex;
    return i === null ? [] : (this.remembered[i] ?? []);
  }

  // ---- writing ----

  set(offset: Address, value: number, max = 100): void {
    if (!this.canWrite) return;
    const v = Math.min(max, Math.max(0, Math.round(value)));
    this.guardUntil[offset] = Date.now() + GUARD_MS;
    if (this.current[offset] === v) return;
    this.current = { ...this.current, [offset]: v };
    this.amp.poke(ADDR.currentPatch + offset, [v]);
  }

  resetParam(offset: Address): void {
    if (!this.canWrite || !this.changed(offset)) return;
    const before = this.value(offset);
    const target = this.storedValue(offset);
    this.set(offset, target);
    this.showToast(`${LABELS.get(offset) ?? '?'} zurück auf ${target}`, () => this.set(offset, before));
  }

  resetAll(): void {
    if (!this.canWrite) return;
    const diffs = this.unsavedOffsets.map((o) => ({ offset: o, value: this.value(o) }));
    if (diffs.length === 0) return;
    for (const d of diffs) this.set(d.offset, this.storedValue(d.offset));
    this.showToast(`${this.slot}: ${diffs.length} Werte zurück auf gespeichert`, () => {
      for (const d of diffs) this.set(d.offset, d.value);
    });
  }

  /** Saves the current patch to its channel. The UI asks for confirmation first (PLAN 4.5 rule 10). */
  save(): void {
    const i = this.s.patchIndex;
    if (!this.canWrite || i === null || i === 0) return;
    this.amp.saveOnAmp(); // stands in for PATCH_WRITE from the app
    this.forget(i);
    this.pauseUntil = Date.now() + 200;
    this.stored = { ...this.current };
    this.showToast(`${this.slot} gespeichert`);
  }

  restoreRemembered(): void {
    const i = this.s.patchIndex;
    if (i === null || !this.canWrite) return;
    const diffs = this.rememberedHere();
    for (const d of diffs) this.set(d.offset, d.value);
    this.forget(i);
    this.showToast(`${diffs.length} Änderungen von ${this.slot} zurückgeholt`);
  }

  discardRemembered(): void {
    const i = this.s.patchIndex;
    if (i !== null) this.forget(i);
  }

  /** Channel change from the app (PATCH_SELECT); no question asked, unsaved changes are remembered (PLAN 2). */
  selectChannel(index: number): void {
    if (index === this.s.patchIndex) return;
    this.rememberCurrent();
    this.pauseUntil = Date.now() + 400;
    this.amp.selectChannelOnAmp(index);
  }

  rereadNow(): void {
    void this.app.connection.readCurrent();
  }

  retry(): void {
    void this.app.connection.connect();
  }

  // ---- simulated actions on the amp ----

  channelOnAmp(index: number): void {
    this.selectChannel(index);
  }

  knobOnAmp(): void {
    if (this.s.phase !== 'connected') return;
    const p = PARAMS[Math.floor(Math.random() * 6)] ?? PARAMS[0];
    if (!p) return;
    const delta = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.floor(Math.random() * 10));
    const v = Math.min(100, Math.max(0, this.value(p.offset) + delta));
    this.amp.turnKnob(ADDR.currentPatch + p.offset, v);
    this.showToast(`Am Amp gedreht: ${p.label} → ${v}`);
  }

  saveOnAmp(): void {
    const i = this.s.patchIndex;
    if (this.s.phase !== 'connected' || i === null) return;
    this.amp.saveOnAmp();
    this.forget(i);
    this.showToast(`Am Amp gespeichert: ${this.slot}`);
  }

  unplug(): void {
    this.mock.unplug();
  }

  plug(): void {
    this.mock.plug();
  }

  failOn(): void {
    this.amp.silent = true;
    this.failing = true;
    this.mock.unplug();
    this.mock.plug();
  }

  failOff(): void {
    this.amp.silent = false;
    this.failing = false;
    this.retry();
  }

  // ---- internals ----

  showToast(text: string, undo?: () => void): void {
    clearTimeout(this.toastTimer);
    this.toast = undo ? { id: ++this.toastId, text, undo } : { id: ++this.toastId, text };
    this.toastTimer = setTimeout(() => (this.toast = null), TOAST_MS);
  }

  private rememberCurrent(): void {
    const i = this.s.patchIndex;
    if (i === null || !this.hasData) return;
    const diffs = this.unsavedOffsets.map((o) => ({ offset: o, value: this.value(o) }));
    if (diffs.length > 0) this.remembered = { ...this.remembered, [i]: diffs };
    else this.forget(i);
  }

  private forget(index: number): void {
    if (!(index in this.remembered)) return;
    this.remembered = Object.fromEntries(
      Object.entries(this.remembered).filter(([k]) => Number(k) !== index),
    );
  }

  private poll(): void {
    const s = this.s;
    const now = Date.now();
    if (s.phase !== 'connected' || s.reading || s.patchIndex === null || now < this.pauseUntil) return;
    const base = storedPatchAddress(s.patchIndex);
    const cur: Record<number, number> = {};
    const st: Record<number, number> = {};
    for (const o of TRACKED) {
      const guarded = (this.guardUntil[o] ?? 0) > now;
      cur[o] = guarded ? (this.current[o] ?? 0) : (this.amp.peek(ADDR.currentPatch + o)?.[0] ?? 0);
      st[o] = this.amp.peek(base + o)?.[0] ?? 0;
    }
    if (!same(cur, this.current)) this.current = cur;
    if (!same(st, this.stored)) this.stored = st;
    this.hasData = true;
  }
}

function same(a: Record<number, number>, b: Record<number, number>): boolean {
  return TRACKED.every((o) => a[o] === b[o]);
}

// ---- Effect detail pages (placeholders) ----
// Types and knobs per effect for the sketch of the effect page. Neither types nor knob addresses are in our
// parameter list yet (PLAN 9.2 E 23); the values live only in this prototype, per effect and colour.

export interface FxKnobDef {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly init: number;
  readonly format?: (v: number) => string;
}

export interface FxDetailDef {
  readonly types: readonly string[];
  readonly knobs: readonly FxKnobDef[];
  /** True when the knobs depend on the type (Mod, FX: Phase 2). */
  readonly typeDependent: boolean;
}

const signed = (v: number): string => (v > 0 ? `+${v}` : String(v));
const level = (key: string, label: string, init: number): FxKnobDef => ({
  key,
  label,
  min: 0,
  max: 100,
  init,
});

export const FX_DETAILS: Readonly<Record<string, FxDetailDef>> = {
  booster: {
    types: ['Clean Boost', 'Mid Boost', 'Treble Boost', 'Overdrive', 'Distortion', 'Fuzz'],
    knobs: [
      { key: 'drive', label: 'Drive', min: 0, max: 120, init: 50 },
      { key: 'bottom', label: 'Bottom', min: -50, max: 50, init: 0, format: signed },
      { key: 'tone', label: 'Tone', min: -50, max: 50, init: 0, format: signed },
      level('level', 'Effect Level', 60),
      level('direct', 'Direct Mix', 0),
      level('solo', 'Solo Level', 50),
    ],
    typeDependent: false,
  },
  mod: {
    types: ['Chorus', 'Flanger', 'Phaser', 'Tremolo', 'Vibrato', 'Rotary'],
    knobs: [level('rate', 'Rate', 40), level('depth', 'Depth', 50), level('level', 'Effect Level', 60)],
    typeDependent: true,
  },
  fx: {
    types: ['Wah', 'Compressor', 'Octave', 'Pitch Shifter', 'Graphic EQ', 'Slicer'],
    knobs: [level('p1', 'Rate', 40), level('p2', 'Depth', 50), level('level', 'Effect Level', 60)],
    typeDependent: true,
  },
  delay: {
    types: ['Digital', 'Analog', 'Tape', 'Reverse', 'Modulate'],
    knobs: [
      { key: 'time', label: 'Time', min: 1, max: 2000, init: 400, format: (v) => `${v} ms` },
      level('feedback', 'Feedback', 30),
      level('highcut', 'High Cut', 70),
      level('level', 'Effect Level', 40),
      level('direct', 'Direct Mix', 100),
    ],
    typeDependent: false,
  },
  reverb: {
    types: ['Room', 'Hall', 'Plate', 'Spring', 'Modulate'],
    knobs: [
      { key: 'time', label: 'Time', min: 1, max: 100, init: 25, format: (v) => `${(v / 10).toFixed(1)} s` },
      { key: 'predelay', label: 'Pre Delay', min: 0, max: 500, init: 20, format: (v) => `${v} ms` },
      level('lowcut', 'Low Cut', 20),
      level('level', 'Effect Level', 35),
      level('direct', 'Direct Mix', 100),
    ],
    typeDependent: false,
  },
};

export class FxPlaceholders {
  types = $state<Record<string, number>>({});
  knobs = $state<Record<string, number>>({});

  typeOf(effect: string, colour: number): number {
    const types = FX_DETAILS[effect]?.types.length ?? 1;
    // Different defaults per colour, so the three variations are told apart in the sketch.
    return this.types[`${effect}:${colour}`] ?? (colour * 2 + (effect.length % 2)) % types;
  }

  typeName(effect: string, colour: number): string {
    return FX_DETAILS[effect]?.types[this.typeOf(effect, colour)] ?? '';
  }

  setType(effect: string, colour: number, type: number): void {
    this.types = { ...this.types, [`${effect}:${colour}`]: type };
  }

  knob(effect: string, colour: number, k: FxKnobDef): number {
    return this.knobs[`${effect}:${colour}:${k.key}`] ?? k.init;
  }

  setKnob(effect: string, colour: number, k: FxKnobDef, v: number): void {
    this.knobs = { ...this.knobs, [`${effect}:${colour}:${k.key}`]: Math.min(k.max, Math.max(k.min, v)) };
  }
}
