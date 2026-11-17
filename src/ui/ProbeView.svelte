<script lang="ts">
  // Rehearsal tab, direction C (PLAN 5, design round): amp type with variation and the six amp knobs always
  // visible; below them quick switches (noise suppressor on/off, contour, "More"), the rest in the window "More"
  // from below: noise suppressor knobs, contour, resonance, power amp (decided 2026-11-17, variant C). No
  // scrolling. Everything here writes: knobs by dragging (double tap = stored value, with undo), LEDs by tapping.
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
  import { CABINET_RESONANCE, contourType } from '../model/sections';
  import {
    SELECTABLE_CHANNELS,
    slotName,
    type AmpConnection,
    type ConnectionState,
    type WriteResult,
  } from '../state/connection';
  import Knob from './Knob.svelte';
  import Sheet from './Sheet.svelte';
  import { paramHelp, typeKey } from './help/help';
  import { longPress } from './help/press';
  import { openHelp } from './help/state.svelte';
  import { t, type Language } from './i18n';
  import { canEdit, dimmed, editable, paramView } from './view';

  let {
    s,
    lang,
    connection,
    onUndoable,
    onSave,
  }: {
    s: ConnectionState;
    lang: Language;
    connection: AmpConnection;
    /** A reset or revert happened: the app offers "Undo" for a moment (PLAN 4.5 rule 7). */
    onUndoable: (text: string, result: WriteResult) => void;
    /** "Save to A1": the app asks for confirmation first (PLAN 4.5 rule 10). */
    onSave: () => void;
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
  /** A1–B4 can be saved, never the Panel (PLAN 1). */
  const savable = $derived(
    canEdit(s) && s.patchIndex !== null && (SELECTABLE_CHANNELS as readonly number[]).includes(s.patchIndex),
  );

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
  const typeDef = $derived(
    contour.value === 1 || contour.value === 2 || contour.value === 3 ? contourType(contour.value) : null,
  );
  const ctype = $derived(typeDef ? paramView(s, typeDef) : null);
  const cab = $derived(paramView(s, CABINET_RESONANCE));
  const moreChanged = $derived(
    (ctype?.changed ?? false) ||
      cab.changed ||
      paramView(s, NS_THRESHOLD).changed ||
      paramView(s, NS_RELEASE).changed ||
      resonance.changed ||
      contour.changed ||
      powerAmp.changed ||
      (freqShift !== null && paramView(s, freqShift).changed),
  );
  const signed = (v: number): string => (v > 0 ? `+${v}` : String(v));
  /** Long press handler: explain a parameter (Phase 3a). */
  const explain = (def: ParamDef, context?: string) => () => openHelp(paramHelp(def, context));
</script>

{#snippet knob(def: ParamDef, context: string)}
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
    help={paramHelp(def, context)}
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
      use:longPress={explain(AMP_VARIATION, t(lang, 'probe.amp'))}
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
        use:longPress={() =>
          openHelp({ key: typeKey('amp', name), title: name, context: t(lang, 'probe.ampType') })}
        onclick={() => set(AMP_TYPE, i)}
      >
        <span class="led" class:lit={type.value === i} class:changed={type.changed}></span>{name}
      </button>
    {/each}
  </div>
  <div class="row">
    {#each AMP_KNOBS as def (def.key)}
      {@render knob(def, t(lang, 'probe.amp'))}
    {/each}
  </div>

  <div class="quick">
    <button
      class="chip"
      class:on={nsOn.value === 1}
      class:changed={nsOn.changed}
      aria-pressed={nsOn.value === 1}
      aria-label={t(lang, 'probe.ns')}
      disabled={!editable(s, NS_SWITCH)}
      use:longPress={explain(NS_SWITCH)}
      onclick={() => set(NS_SWITCH, nsOn.value === 1 ? 0 : 1)}
    >
      <span class="led" class:lit={nsOn.value === 1} class:changed={nsOn.changed}></span>
      {t(lang, 'probe.nsShort')}
      {nsOn.value === 1 ? t(lang, 'fx.on') : t(lang, 'fx.off')}
    </button>
    <button
      class="chip"
      class:changed={contour.changed}
      aria-haspopup="dialog"
      use:longPress={explain(CONTOUR_SELECT, t(lang, 'probe.amp'))}
      onclick={() => (more = true)}
    >
      {CONTOUR_SELECT.label}
      {contour.value === 1 || contour.value === 2 || contour.value === 3
        ? contour.value
        : t(lang, 'probe.contourOff')}
    </button>
    <button
      class="chip more"
      class:changed={moreChanged}
      aria-haspopup="dialog"
      onclick={() => (more = true)}
    >
      {t(lang, 'probe.more')}
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
    </button>
  </div>
  <div class="actions">
    <button class="revert" disabled={!unsaved || !canEdit(s)} onclick={() => void revertAll()}>
      {t(lang, 'action.revertAll')}
    </button>
    <button class="save" class:primary={unsaved} disabled={!savable} onclick={onSave}>
      {s.saving ? t(lang, 'save.running') : t(lang, 'action.save', { slot: slotName(s.patchIndex) })}
    </button>
  </div>
  <p class="hint">{t(lang, 'probe.hint')}</p>
</div>

{#if more}
  <Sheet title={t(lang, 'probe.more')} closeLabel={t(lang, 'sheet.close')} onClose={() => (more = false)}>
    <div class="moresheet" class:dim={dimmed(s)}>
      <div class="sect">
        <span class="title">{t(lang, 'probe.ns')}</span>
        <i></i>
        <button
          class="ledlabel"
          class:on={nsOn.value === 1}
          aria-pressed={nsOn.value === 1}
          aria-label={NS_SWITCH.label}
          disabled={!editable(s, NS_SWITCH)}
          use:longPress={explain(NS_SWITCH)}
          onclick={() => set(NS_SWITCH, nsOn.value === 1 ? 0 : 1)}
        >
          <span class="led" class:lit={nsOn.value === 1} class:changed={nsOn.changed}></span>
          {nsOn.value === 1 ? t(lang, 'fx.on') : t(lang, 'fx.off')}
        </button>
      </div>
      <div class="row">
        {@render knob(NS_THRESHOLD, t(lang, 'probe.ns'))}
        {@render knob(NS_RELEASE, t(lang, 'probe.ns'))}
      </div>
      <div class="sect"><span class="title">{CONTOUR_SELECT.label}</span><i></i></div>
      <div class="selector four" role="radiogroup" aria-label={CONTOUR_SELECT.label}>
        {#each CONTOUR_NAMES as name, i (name)}
          <button
            class="choice"
            class:sel={contour.value === i}
            role="radio"
            aria-checked={contour.value === i}
            disabled={!editable(s, CONTOUR_SELECT)}
            use:longPress={explain(CONTOUR_SELECT, t(lang, 'probe.amp'))}
            onclick={() => set(CONTOUR_SELECT, i)}
          >
            <span class="led" class:lit={contour.value === i} class:changed={contour.changed}></span>
            {i === 0 ? t(lang, 'probe.contourOff') : name}
          </button>
        {/each}
      </div>
      {#if typeDef && ctype}
        <div class="selector four" role="radiogroup" aria-label={t(lang, 'probe.contourType')}>
          {#each [0, 1, 2, 3] as i (i)}
            <button
              class="choice"
              class:sel={ctype.value === i}
              role="radio"
              aria-checked={ctype.value === i}
              disabled={!editable(s, typeDef)}
              use:longPress={explain(typeDef, CONTOUR_SELECT.label)}
              onclick={() => set(typeDef, i)}
            >
              <span class="led" class:lit={ctype.value === i} class:changed={ctype.changed}></span>
              {t(lang, 'probe.contourType')}
              {i + 1}
            </button>
          {/each}
        </div>
      {/if}
      <div class="row">
        {#if freqShift}
          {@render knob(freqShift, CONTOUR_SELECT.label)}
        {:else}
          <p class="off">{t(lang, 'probe.freqShiftOff')}</p>
        {/if}
        {@render knob(AMP_RESONANCE, t(lang, 'probe.amp'))}
        <div class="cell">
          <button
            class="ledlabel big"
            class:on={powerAmp.value === 1}
            aria-pressed={powerAmp.value === 1}
            disabled={!editable(s, AMP_POWERAMP_VARIATION)}
            use:longPress={explain(AMP_POWERAMP_VARIATION, t(lang, 'probe.amp'))}
            onclick={() => set(AMP_POWERAMP_VARIATION, powerAmp.value === 1 ? 0 : 1)}
          >
            <span class="led" class:lit={powerAmp.value === 1} class:changed={powerAmp.changed}></span>
            {powerAmp.value === 1 ? t(lang, 'fx.on') : t(lang, 'fx.off')}
          </button>
          <span class="celllabel">{t(lang, 'probe.powerAmp')}</span>
        </div>
      </div>
      <div class="sect"><span class="title">{CABINET_RESONANCE.label}</span><i></i></div>
      <div class="selector three" role="radiogroup" aria-label={CABINET_RESONANCE.label}>
        {#each CABINET_RESONANCE.display?.table ?? [] as name, i (name)}
          <button
            class="choice"
            class:sel={cab.value === i}
            role="radio"
            aria-checked={cab.value === i}
            disabled={!editable(s, CABINET_RESONANCE)}
            use:longPress={explain(CABINET_RESONANCE, t(lang, 'probe.amp'))}
            onclick={() => set(CABINET_RESONANCE, i)}
          >
            <span class="led" class:lit={cab.value === i} class:changed={cab.changed}></span>
            {name}
          </button>
        {/each}
      </div>
    </div>
  </Sheet>
{/if}

<style>
  /*
   * The rehearsal tab never needs scrolling (PLAN 5, design round): it fits into the height of <main>. The two
   * rows of amp knobs take what is left (up to 112 px); when space is short the hint goes first, then the knobs
   * get smaller (down to 64 px). --fixed is the height of everything except the two knob circles.
   */
  .panel {
    --knob-max: clamp(64px, calc((100cqh - var(--fixed)) / 2), 112px);
    --fixed: 340px;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    min-height: 100%;
    padding: 0 14px 8px;
  }
  @container (max-height: 580px) {
    .hint {
      display: none;
    }
    .panel {
      --fixed: 318px;
    }
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
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 10px;
  }
  .revert,
  .save {
    background: none;
    border: 1px solid var(--faint);
    color: var(--fg);
    font-weight: 600;
  }
  .save {
    border-color: var(--accent);
    color: var(--accent);
  }
  .save.primary {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 700;
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
  /* "More" fits its window (85 % of the screen): the two knob rows shrink on short screens (56–100 px). */
  .moresheet {
    --knob-max: clamp(56px, calc((85dvh - 352px) / 2 - 48px), 100px);
  }
  .selector.three {
    grid-template-columns: repeat(3, 1fr);
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
  /* Quick switches and the save buttons sit at the bottom, under the thumb; spare height goes above them. */
  .quick {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
    margin: auto 0 2px;
    padding-top: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 10px;
    border-radius: 22px;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
  }
  .chip.on {
    color: var(--fg);
  }
  .chip.changed {
    box-shadow: inset 0 0 0 1.5px var(--warn);
  }
  .chip.more {
    color: var(--accent);
  }
  .chip svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .hint {
    color: var(--faint);
    font-size: 0.75rem;
    text-align: center;
    margin: 6px 8px 0;
  }
</style>
