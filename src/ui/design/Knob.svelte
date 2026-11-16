<script lang="ts">
  // Design prototype: one round knob (direction C). Drag up/down; double tap resets to the stored value.
  import { relativeDrag } from './drag';

  let {
    label,
    value,
    min = 0,
    max = 100,
    stored = null,
    enabled,
    format = (v: number) => String(v),
    onchange,
    onreset,
    onactive,
  }: {
    label: string;
    value: number;
    min?: number;
    max?: number;
    /** Stored value; when it differs from `value`, the knob shows "changed" and a dot at the stored position. */
    stored?: number | null;
    enabled: boolean;
    format?: (v: number) => string;
    onchange: (v: number) => void;
    onreset?: () => void;
    onactive?: (dragging: boolean) => void;
  } = $props();

  const START = 135;
  const SWEEP = 270;
  const frac = (v: number) => (max === min ? 0 : (v - min) / (max - min));
  const changed = $derived(stored !== null && stored !== value);
  const angle = $derived(START + SWEEP * frac(value));
  let dragging = $state(false);

  function polar(a: number, r: number): [number, number] {
    const rad = (a * Math.PI) / 180;
    return [50 + r * Math.cos(rad), 50 + r * Math.sin(rad)];
  }
  function arc(from: number, to: number, r: number): string {
    const [x1, y1] = polar(from, r);
    const [x2, y2] = polar(to, r);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  }
  // Bipolar knobs (e.g. -50…+50) draw the arc from the centre.
  const origin = $derived(min < 0 && max > 0 ? START + SWEEP * frac(0) : START);
  const ptrIn = $derived(polar(angle, 11));
  const ptr = $derived(polar(angle, 26));
  // Eleven scale marks like the 0–10 print around an amp knob.
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = START + (SWEEP * i) / 10;
    return { a: polar(a, 45), b: polar(a, i % 5 === 0 ? 49.5 : 48) };
  });
  const storedPos = $derived(stored === null ? null : polar(START + SWEEP * frac(stored), 39));
</script>

<div
  class="knob"
  class:changed
  class:active={dragging}
  role="slider"
  tabindex="0"
  aria-label={label}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={value}
  use:relativeDrag={{
    axis: 'y',
    pxPerStep: Math.max(0.6, 260 / Math.max(1, max - min)),
    get: () => value,
    set: (x) => onchange(Math.min(max, Math.max(min, x))),
    enabled: () => enabled,
    ...(onreset ? { onDoubleTap: onreset } : {}),
    onDrag: (d) => {
      dragging = d;
      onactive?.(d);
    },
  }}
>
  <svg viewBox="0 0 100 100" aria-hidden="true">
    {#each ticks as t, i (i)}
      <line x1={t.a[0]} y1={t.a[1]} x2={t.b[0]} y2={t.b[1]} class="tick" />
    {/each}
    <path d={arc(START, START + SWEEP, 39)} class="track" />
    {#if angle !== origin}
      <path d={arc(Math.min(origin, angle), Math.max(origin, angle), 39)} class="val" />
    {/if}
    <circle cx="50" cy="50" r="31" class="skirt" />
    <circle cx="50" cy="50" r="26" class="cap" />
    <line x1={ptrIn[0]} y1={ptrIn[1]} x2={ptr[0]} y2={ptr[1]} class="ptr" />
    {#if changed && storedPos}
      <circle cx={storedPos[0]} cy={storedPos[1]} r="2.6" class="stored" />
    {/if}
  </svg>
  <span class="num">{format(value)}</span>
  <span class="label">{label}</span>
</div>

<style>
  .knob {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2px 0 8px;
    border-radius: 14px;
    cursor: ns-resize;
    user-select: none;
    outline: none;
  }
  .knob:focus-visible {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .knob.active {
    background: var(--panel-2);
  }
  svg {
    width: 100%;
    max-width: 100px;
    aspect-ratio: 1;
    overflow: visible;
  }
  .tick {
    stroke: var(--faint);
    stroke-width: 1.4;
    stroke-linecap: round;
  }
  .track {
    fill: none;
    stroke: var(--track);
    stroke-width: 3.5;
    stroke-linecap: round;
  }
  .val {
    fill: none;
    stroke: var(--accent);
    stroke-width: 3.5;
    stroke-linecap: round;
    filter: drop-shadow(0 0 3px color-mix(in srgb, var(--accent) 60%, transparent));
  }
  .changed .val {
    stroke: var(--warn);
    filter: drop-shadow(0 0 3px color-mix(in srgb, var(--warn) 60%, transparent));
  }
  .skirt {
    fill: var(--knob-skirt);
  }
  .cap {
    fill: var(--knob-cap);
    stroke: var(--knob-rim);
    stroke-width: 1;
  }
  .ptr {
    stroke: var(--fg);
    stroke-width: 3;
    stroke-linecap: round;
  }
  .stored {
    fill: var(--fg);
    stroke: var(--bg);
    stroke-width: 1;
  }
  .num {
    margin-top: -2px;
    font-size: 1.35rem;
    font-weight: 700;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }
  .changed .num {
    color: var(--warn);
  }
  .label {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    text-align: center;
  }
</style>
