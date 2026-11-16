<script lang="ts">
  // Rehearsal tab, direction C (PLAN 5, design round): amp type with variation, the six amp knobs and the noise
  // suppressor always visible, the rest under "More" in a window from below (no scrolling). Phase 1a only shows
  // values; the knobs do not write yet.
  import {
    AMP_KNOBS,
    AMP_RESONANCE,
    AMP_TYPE,
    AMP_TYPE_NAMES,
    AMP_VARIATION,
    NS_RELEASE,
    NS_SWITCH,
    NS_THRESHOLD,
  } from '../model/params';
  import type { ParamDef } from '../model/schema';
  import type { ConnectionState } from '../state/connection';
  import Knob from './Knob.svelte';
  import Sheet from './Sheet.svelte';
  import { t, type Language } from './i18n';
  import { dimmed, paramView } from './view';

  let { s, lang }: { s: ConnectionState; lang: Language } = $props();
  let more = $state(false);

  const type = $derived(paramView(s, AMP_TYPE));
  const variation = $derived(paramView(s, AMP_VARIATION));
  const nsOn = $derived(paramView(s, NS_SWITCH));
  const resonance = $derived(paramView(s, AMP_RESONANCE));
</script>

{#snippet knob(def: ParamDef)}
  {@const v = paramView(s, def)}
  <Knob label={def.label} value={v.value} stored={v.stored} min={def.min} max={def.max} />
{/snippet}

<div class="panel" class:dim={dimmed(s)}>
  <div class="sect">
    <span class="title">{t(lang, 'probe.amp')}</span>
    <i></i>
    <span class="ledlabel" class:on={variation.value === 1}>
      <span class="led" class:lit={variation.value === 1} class:changed={variation.changed}></span>
      {AMP_VARIATION.label}
    </span>
  </div>
  <div class="selector" role="radiogroup" aria-label={t(lang, 'probe.ampType')} aria-readonly="true">
    {#each AMP_TYPE_NAMES as name, i (name)}
      <span class="choice" class:sel={type.value === i} role="radio" aria-checked={type.value === i}>
        <span class="led" class:lit={type.value === i} class:changed={type.changed}></span>{name}
      </span>
    {/each}
  </div>
  <div class="row">
    {#each AMP_KNOBS as def (def.key)}
      {@render knob(def)}
    {/each}
  </div>

  <div class="sect">
    <span class="title">{t(lang, 'probe.ns')}</span>
    <i></i>
    <span class="led" class:lit={nsOn.value === 1} class:changed={nsOn.changed} aria-hidden="true"></span>
  </div>
  <div class="row">
    {@render knob(NS_THRESHOLD)}
    {@render knob(NS_RELEASE)}
    <button
      class="more"
      class:changed={resonance.changed}
      aria-haspopup="dialog"
      onclick={() => (more = true)}
    >
      <span class="ring">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
      </span>
      <span class="moretitle">{t(lang, 'probe.more')}</span>
      <span class="moresub">{t(lang, 'probe.moreSub')}</span>
    </button>
  </div>
  <p class="hint">{t(lang, 'probe.readOnlyHint')}</p>
</div>

{#if more}
  <Sheet title={t(lang, 'probe.more')} closeLabel={t(lang, 'sheet.close')} onClose={() => (more = false)}>
    <div class="row" class:dim={dimmed(s)}>
      {@render knob(AMP_RESONANCE)}
    </div>
    <p class="hint">{t(lang, 'probe.moreLater')}</p>
  </Sheet>
{/if}

<style>
  .panel {
    padding: 0 14px 8px;
  }
  .dim {
    opacity: 0.45;
  }
  .ledlabel {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 4px 0 8px;
    color: var(--muted);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .ledlabel.on {
    color: var(--fg);
  }
  .selector {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    margin: 0 -2px 2px;
  }
  .choice {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    min-height: 48px;
    padding: 6px 0 4px;
    box-sizing: border-box;
    color: var(--muted);
    font-size: 0.74rem;
    font-weight: 600;
  }
  .choice.sel {
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
  .hint {
    color: var(--faint);
    font-size: 0.75rem;
    text-align: center;
    margin: 6px 8px 0;
  }
</style>
