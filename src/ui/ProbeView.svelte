<script lang="ts">
  // Rehearsal tab, direction C (PLAN 5, design round): amp type with variation, the six amp knobs and the noise
  // suppressor always visible, the rest under "More" in a window from below (no scrolling). Since 1b everything
  // here writes: knobs by dragging (double tap = stored value, with undo), LEDs by tapping.
  import {
    AMP_KNOBS,
    AMP_POWERAMP_VARIATION,
    AMP_RESONANCE,
    AMP_TYPE,
    AMP_TYPE_NAMES,
    AMP_VARIATION,
    CONTOUR_NAMES,
    CONTOUR_SELECT,
    NS_RELEASE,
    NS_SWITCH,
    NS_THRESHOLD,
    contourFreqShift,
  } from '../model/params';
  import type { ParamDef } from '../model/schema';
  import type { AmpConnection, ConnectionState, WriteResult } from '../state/connection';
  import Knob from './Knob.svelte';
  import Sheet from './Sheet.svelte';
  import { t, type Language } from './i18n';
  import { canEdit, dimmed, editable, paramView } from './view';

  let {
    s,
    lang,
    connection,
    onUndoable,
  }: {
    s: ConnectionState;
    lang: Language;
    connection: AmpConnection;
    /** A reset or revert happened: the app offers "Undo" for a moment (PLAN 4.5 rule 7). */
    onUndoable: (text: string, result: WriteResult) => void;
  } = $props();
  let more = $state(false);

  function set(def: ParamDef, raw: number): void {
    if (editable(s, def)) void connection.setValue(def, raw);
  }
  async function reset(def: ParamDef): Promise<void> {
    if (!editable(s, def)) return;
    const result = await connection.revertParam(def);
    if (result && result.previous.length > 0) onUndoable(t(lang, 'undo.reset', { name: def.label }), result);
  }
  async function revertAll(): Promise<void> {
    const result = await connection.revertAll();
    if (result && (result.previous.length > 0 || result.skipped > 0)) {
      onUndoable(t(lang, 'undo.revertAll'), result);
    }
  }
  const unsaved = $derived(s.unsavedKnown && s.unsaved.length > 0);

  const type = $derived(paramView(s, AMP_TYPE));
  const variation = $derived(paramView(s, AMP_VARIATION));
  const nsOn = $derived(paramView(s, NS_SWITCH));
  const resonance = $derived(paramView(s, AMP_RESONANCE));
  const contour = $derived(paramView(s, CONTOUR_SELECT));
  const powerAmp = $derived(paramView(s, AMP_POWERAMP_VARIATION));
  const freqShift = $derived(
    contour.value === 1 || contour.value === 2 || contour.value === 3
      ? contourFreqShift(contour.value)
      : null,
  );
  const moreChanged = $derived(
    resonance.changed ||
      contour.changed ||
      powerAmp.changed ||
      (freqShift !== null && paramView(s, freqShift).changed),
  );
  const signed = (v: number): string => (v > 0 ? `+${v}` : String(v));
</script>

{#snippet knob(def: ParamDef)}
  {@const v = paramView(s, def)}
  {@const off = def.display?.rawOffset ?? 0}
  <Knob
    label={def.label}
    value={v.value === undefined ? undefined : v.value - off}
    stored={v.stored === null ? null : v.stored - off}
    min={def.min - off}
    max={def.max - off}
    enabled={editable(s, def)}
    onchange={(x) => set(def, x + off)}
    onreset={() => void reset(def)}
    {...off !== 0 ? { format: signed } : {}}
  />
{/snippet}

<div class="panel" class:dim={dimmed(s)}>
  <div class="sect">
    <span class="title">{t(lang, 'probe.amp')}</span>
    <i></i>
    <button
      class="ledlabel"
      class:on={variation.value === 1}
      aria-pressed={variation.value === 1}
      disabled={!editable(s, AMP_VARIATION)}
      onclick={() => set(AMP_VARIATION, variation.value === 1 ? 0 : 1)}
    >
      <span class="led" class:lit={variation.value === 1} class:changed={variation.changed}></span>
      {AMP_VARIATION.label}
    </button>
  </div>
  <div class="selector" role="radiogroup" aria-label={t(lang, 'probe.ampType')}>
    {#each AMP_TYPE_NAMES as name, i (name)}
      <button
        class="choice"
        class:sel={type.value === i}
        role="radio"
        aria-checked={type.value === i}
        disabled={!editable(s, AMP_TYPE)}
        onclick={() => set(AMP_TYPE, i)}
      >
        <span class="led" class:lit={type.value === i} class:changed={type.changed}></span>{name}
      </button>
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
    <button
      class="ledlabel"
      class:on={nsOn.value === 1}
      aria-pressed={nsOn.value === 1}
      aria-label={NS_SWITCH.label}
      disabled={!editable(s, NS_SWITCH)}
      onclick={() => set(NS_SWITCH, nsOn.value === 1 ? 0 : 1)}
    >
      <span class="led" class:lit={nsOn.value === 1} class:changed={nsOn.changed}></span>
      {nsOn.value === 1 ? t(lang, 'fx.on') : t(lang, 'fx.off')}
    </button>
  </div>
  <div class="row">
    {@render knob(NS_THRESHOLD)}
    {@render knob(NS_RELEASE)}
    <button class="more" class:changed={moreChanged} aria-haspopup="dialog" onclick={() => (more = true)}>
      <span class="ring">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
      </span>
      <span class="moretitle">{t(lang, 'probe.more')}</span>
      <span class="moresub">{t(lang, 'probe.moreSub')}</span>
    </button>
  </div>
  <button class="revert" disabled={!unsaved || !canEdit(s)} onclick={() => void revertAll()}>
    {t(lang, 'action.revertAll')}
  </button>
  <p class="hint">{t(lang, 'probe.hint')}</p>
</div>

{#if more}
  <Sheet title={t(lang, 'probe.more')} closeLabel={t(lang, 'sheet.close')} onClose={() => (more = false)}>
    <div class:dim={dimmed(s)}>
      <div class="sect"><span class="title">{CONTOUR_SELECT.label}</span><i></i></div>
      <div class="selector four" role="radiogroup" aria-label={CONTOUR_SELECT.label}>
        {#each CONTOUR_NAMES as name, i (name)}
          <button
            class="choice"
            class:sel={contour.value === i}
            role="radio"
            aria-checked={contour.value === i}
            disabled={!editable(s, CONTOUR_SELECT)}
            onclick={() => set(CONTOUR_SELECT, i)}
          >
            <span class="led" class:lit={contour.value === i} class:changed={contour.changed}></span>
            {i === 0 ? t(lang, 'probe.contourOff') : name}
          </button>
        {/each}
      </div>
      <div class="row">
        {#if freqShift}
          {@render knob(freqShift)}
        {:else}
          <p class="off">{t(lang, 'probe.freqShiftOff')}</p>
        {/if}
        {@render knob(AMP_RESONANCE)}
        <div class="cell">
          <button
            class="ledlabel big"
            class:on={powerAmp.value === 1}
            aria-pressed={powerAmp.value === 1}
            disabled={!editable(s, AMP_POWERAMP_VARIATION)}
            onclick={() => set(AMP_POWERAMP_VARIATION, powerAmp.value === 1 ? 0 : 1)}
          >
            <span class="led" class:lit={powerAmp.value === 1} class:changed={powerAmp.changed}></span>
            {powerAmp.value === 1 ? t(lang, 'fx.on') : t(lang, 'fx.off')}
          </button>
          <span class="celllabel">{t(lang, 'probe.powerAmp')}</span>
        </div>
      </div>
    </div>
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
  /* LEDs and choices are buttons: no button look, and not dimmed when locked (the panel dims as a whole). */
  button.ledlabel:not(.big),
  button.choice {
    background: none;
    border: none;
    border-radius: 10px;
  }
  button.ledlabel:disabled,
  button.choice:disabled {
    opacity: 1;
  }
  button.ledlabel:not(:disabled):active,
  button.choice:not(:disabled):active {
    background: var(--panel-2);
  }
  .revert {
    display: block;
    width: 100%;
    margin-top: 10px;
    background: none;
    border: 1px solid var(--faint);
    color: var(--fg);
    font-weight: 600;
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
  .selector.four {
    grid-template-columns: repeat(4, 1fr);
  }
  .off,
  .celllabel {
    color: var(--faint);
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
  }
  .celllabel {
    color: var(--muted);
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .ledlabel.big {
    min-height: 52px;
    padding: 0 16px;
    border-radius: 12px;
    background: var(--panel);
    font-size: 0.85rem;
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
