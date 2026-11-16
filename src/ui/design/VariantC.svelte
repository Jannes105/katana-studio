<script lang="ts">
  // Direction C "Regler": amp type and variation, the six amp knobs and the noise suppressor always visible;
  // contour, resonance and power amp variation in a second level ("Mehr"). Effects live on their own page.
  // While dragging, the value appears large at the top because the thumb covers the knob.
  import Knob from './Knob.svelte';
  import Sheet from './Sheet.svelte';
  import {
    AMP_TYPE,
    AMP_TYPES,
    GROUP_TITLES,
    PARAMS,
    POWERAMP_VARIATION,
    PREAMP_VARIATION,
    RESONANCE,
    type ParamDef,
    type Proto,
  } from './proto.svelte';

  let { proto }: { proto: Proto } = $props();
  let active = $state<{ label: string; value: () => number; changed: () => boolean } | null>(null);
  let more = $state(false);
  const amp = PARAMS.filter((p) => p.group === 'amp');
  const ns = PARAMS.filter((p) => p.group === 'ns');
  const signed = (v: number): string => (v > 0 ? `+${v}` : String(v));

  function track(p: ParamDef) {
    return (d: boolean) =>
      (active = d
        ? { label: p.label, value: () => proto.value(p.offset), changed: () => proto.changed(p.offset) }
        : null);
  }
  const type = $derived(proto.value(AMP_TYPE));
  const preVar = $derived(proto.value(PREAMP_VARIATION) === 1);
  const powerVar = $derived(proto.value(POWERAMP_VARIATION) === 1);
  const extraChanged = $derived(proto.changed(RESONANCE.offset) || proto.changed(POWERAMP_VARIATION));
</script>

{#snippet knob(p: ParamDef)}
  <Knob
    label={p.label}
    value={proto.value(p.offset)}
    stored={proto.storedValue(p.offset)}
    enabled={proto.canWrite}
    onchange={(v) => proto.set(p.offset, v)}
    onreset={() => proto.resetParam(p.offset)}
    onactive={track(p)}
  />
{/snippet}

{#if active}
  <div class="bubble" class:changed={active.changed()}>
    <span>{active.label}</span>
    <strong>{active.value()}</strong>
  </div>
{/if}

<div class="panel" class:locked={!proto.canWrite}>
  <div class="sect">
    <span class="title">{GROUP_TITLES.amp}</span>
    <i></i>
    <button
      class="led-toggle"
      class:on={preVar}
      class:changed={proto.changed(PREAMP_VARIATION)}
      role="switch"
      aria-checked={preVar}
      disabled={!proto.canWrite}
      onclick={() => proto.set(PREAMP_VARIATION, preVar ? 0 : 1, 1)}
    >
      <span class="led"></span>Variation
    </button>
  </div>
  <div class="selector" role="radiogroup" aria-label="Amp-Typ" class:changed={proto.changed(AMP_TYPE)}>
    {#each AMP_TYPES as t, i (t)}
      <button
        role="radio"
        aria-checked={type === i}
        class:sel={type === i}
        disabled={!proto.canWrite}
        onclick={() => proto.set(AMP_TYPE, i, AMP_TYPES.length - 1)}
      >
        <span class="led"></span>{t}
      </button>
    {/each}
  </div>
  <div class="row">
    {#each amp as p (p.key)}
      {@render knob(p)}
    {/each}
  </div>

  <div class="sect"><span class="title">{GROUP_TITLES.ns}</span><i></i></div>
  <div class="row">
    {#each ns as p (p.key)}
      {@render knob(p)}
    {/each}
    <button
      class="more"
      class:open={more}
      class:changed={extraChanged}
      aria-haspopup="dialog"
      onclick={() => (more = !more)}
    >
      <span class="ring">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
      </span>
      <span class="moretitle">Mehr</span>
      <span class="moresub">Contour · Resonance · Endstufe</span>
    </button>
  </div>
</div>

{#if more}
  <Sheet title="Mehr" onClose={() => (more = false)}>
    <div class="sheetbody" class:locked={!proto.canWrite}>
      <div class="sect">
        <span class="title">Contour</span>
        <span class="tag">Platzhalter</span>
        <i></i>
      </div>
      <div class="selector four" role="radiogroup" aria-label="Contour">
        {#each ['Aus', '1', '2', '3'] as c, i (c)}
          <button
            role="radio"
            aria-checked={proto.contour.select === i}
            class:sel={proto.contour.select === i}
            disabled={!proto.canWrite}
            onclick={() => (proto.contour.select = i)}
          >
            <span class="led"></span>{c}
          </button>
        {/each}
      </div>
      <div class="row">
        {#if proto.contour.select > 0}
          {@const idx = proto.contour.select - 1}
          <Knob
            label="Freq Shift"
            value={proto.contour.shift[idx] ?? 0}
            min={-50}
            max={50}
            format={signed}
            enabled={proto.canWrite}
            onchange={(v) => (proto.contour.shift[idx] = v)}
          />
        {:else}
          <p class="off">Freq Shift<br />Contour aus</p>
        {/if}
        {@render knob(RESONANCE)}
        <div class="cell">
          <button
            class="led-toggle big"
            class:on={powerVar}
            class:changed={proto.changed(POWERAMP_VARIATION)}
            role="switch"
            aria-checked={powerVar}
            disabled={!proto.canWrite}
            onclick={() => proto.set(POWERAMP_VARIATION, powerVar ? 0 : 1, 1)}
          >
            <span class="led"></span>{powerVar ? 'An' : 'Aus'}
          </button>
          <span class="celllabel">Endstufen-<br />Variation</span>
        </div>
      </div>
    </div>
  </Sheet>
{/if}

<style>
  .panel {
    padding: 0 14px 8px;
  }
  .sheetbody {
    padding-bottom: 4px;
  }
  .sheetbody .sect:first-child {
    margin-top: 0;
  }
  .locked {
    opacity: 0.45;
  }
  .sect {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    margin-top: 4px;
  }
  .sect .title {
    color: var(--muted);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }
  .sect i {
    flex: 1;
    height: 1px;
    background: var(--line);
  }
  .tag {
    font-size: 0.65rem;
    color: var(--faint);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 1px 5px;
  }
  .led {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--led-off);
    flex: none;
    transition:
      background 0.12s,
      box-shadow 0.12s;
  }
  .led-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 4px 0 8px;
    background: none;
    border: none;
    color: var(--muted);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .led-toggle.on {
    color: var(--fg);
  }
  .led-toggle.on .led,
  .selector .sel .led {
    background: var(--accent);
    box-shadow: 0 0 6px 1px color-mix(in srgb, var(--accent) 70%, transparent);
  }
  .led-toggle.changed.on .led,
  .selector.changed .sel .led {
    background: var(--warn);
    box-shadow: 0 0 6px 1px color-mix(in srgb, var(--warn) 70%, transparent);
  }
  .led-toggle.big {
    min-height: 52px;
    padding: 0 16px;
    border-radius: 12px;
    background: var(--panel);
    font-size: 0.85rem;
  }
  .selector {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    margin: 0 -2px 2px;
  }
  .selector.four {
    grid-template-columns: repeat(4, 1fr);
  }
  .selector button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    min-height: 48px;
    padding: 6px 0 4px;
    background: none;
    border: none;
    border-radius: 10px;
    color: var(--muted);
    font-size: 0.74rem;
    font-weight: 600;
  }
  .selector button.sel {
    color: var(--fg);
  }
  .row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0 4px;
  }
  .more {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 2px;
    padding: 2px 0 8px;
    background: none;
    border: none;
    color: var(--muted);
  }
  .ring {
    width: 62%;
    max-width: 62px;
    aspect-ratio: 1;
    margin: 19% 0 8px;
    border-radius: 50%;
    border: 1.5px dashed var(--faint);
    display: grid;
    place-items: center;
  }
  .ring svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 0.15s;
  }
  .more.changed .ring {
    border-color: var(--warn);
  }
  .moretitle {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--fg);
  }
  .moresub {
    font-size: 0.62rem;
    text-align: center;
    line-height: 1.3;
  }
  .off,
  .celllabel {
    color: var(--muted);
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    text-align: center;
    line-height: 1.35;
  }
  .off {
    align-self: center;
    margin: 0;
    color: var(--faint);
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .bubble {
    position: fixed;
    top: 84px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 35;
    min-width: 140px;
    background: var(--sheet);
    border-radius: 18px;
    padding: 10px 28px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
    box-shadow:
      0 0 0 1px var(--line),
      0 12px 40px rgb(0 0 0 / 60%);
  }
  .bubble span {
    color: var(--muted);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }
  .bubble strong {
    font-size: 4.2rem;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  .bubble.changed strong {
    color: var(--warn);
  }
</style>
