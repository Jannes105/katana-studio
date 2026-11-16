<script lang="ts">
  // Effects tab, direction C (PLAN 5, design round): one list with on/off, active variation and its type; a tap
  // opens the effect page with all three variations. Since 1b everything here writes: on/off, active variation,
  // type, and the knobs of booster, delay and reverb for the type of the active variation (mod and FX knobs
  // follow in Phase 2).
  import { NS_RELEASE, NS_SWITCH, NS_THRESHOLD, effectType } from '../model/params';
  import { instanceParam, visibleFor, type ParamDef } from '../model/schema';
  import type { AmpConnection, ConnectionState, WriteResult } from '../state/connection';
  import Knob from './Knob.svelte';
  import Sheet from './Sheet.svelte';
  import { t, type Language, type TextKey } from './i18n';
  import { dimmed, editable, effectRows, paramView, type EffectRow } from './view';

  let {
    s,
    lang,
    connection,
    onUndoable,
  }: {
    s: ConnectionState;
    lang: Language;
    connection: AmpConnection;
    /** A reset happened: the app offers "Undo" for a moment (PLAN 4.5 rule 7). */
    onUndoable: (text: string, result: WriteResult) => void;
  } = $props();
  /** Key of the effect whose page is open; 'ns' for the noise suppressor. */
  let open = $state<string | null>(null);
  /** The type list of the active variation is open. */
  let choosingType = $state(false);

  const COLOUR_CSS = ['var(--c-green)', 'var(--c-red)', 'var(--c-yellow)'] as const;
  const colourCss = (c: number | undefined) =>
    c === undefined ? 'var(--accent)' : (COLOUR_CSS[c] ?? 'var(--accent)');
  const colourName = (c: number) => t(lang, `colour.${c}` as TextKey);

  const rows = $derived(effectRows(s));
  const row = $derived(rows.find((r) => r.key === open));
  const ns = $derived(paramView(s, NS_SWITCH));
  const nsChanged = $derived(
    ns.changed || paramView(s, NS_THRESHOLD).changed || paramView(s, NS_RELEASE).changed,
  );
  const typeNamesMissing = $derived(rows.some((r) => r.group.typeNames.length === 0));

  /** The parameters of the active variation that its type shows (read-only ones such as layer mode left out). */
  function activeParams(r: EffectRow): ParamDef[] {
    if (r.colour === undefined) return [];
    const colour = r.colour;
    const type = r.types[colour];
    return r.group.params
      .filter((p) => !p.readonly && visibleFor(p, type))
      .map((p) => instanceParam(r.group, colour, p));
  }

  function set(def: ParamDef, raw: number): void {
    if (editable(s, def)) void connection.setValue(def, raw);
  }
  async function reset(def: ParamDef): Promise<void> {
    if (!editable(s, def)) return;
    const result = await connection.revertParam(def);
    if (result && result.previous.length > 0) onUndoable(t(lang, 'undo.reset', { name: def.label }), result);
  }
  function chooseType(r: EffectRow, type: number): void {
    choosingType = false;
    if (r.colour !== undefined) set(effectType(r.group, r.colour), type);
  }

  const signed = (v: number): string => (v > 0 ? `+${v}` : String(v));
  /** How a knob shows its value: name from the table, signed around a centre, with unit. */
  function format(def: ParamDef): (shown: number) => string {
    const off = def.display?.rawOffset ?? 0;
    const table = def.display?.table;
    const unit = def.display?.unit;
    return (v) => {
      if (table) return table[v + off] ?? String(v);
      const text = def.min - off < 0 ? signed(v) : String(v);
      return unit ? `${text} ${unit}` : text;
    };
  }
</script>

{#snippet toggle(on: boolean | undefined, label: string, withState: boolean, def: ParamDef | null)}
  <button
    class="switch"
    class:on
    role="switch"
    aria-checked={on === true}
    aria-label={label}
    disabled={def === null || !editable(s, def)}
    onclick={() => def && set(def, on ? 0 : 1)}
  >
    {#if withState}<span class="state">{on ? t(lang, 'fx.on') : t(lang, 'fx.off')}</span>{/if}
    <span class="track"><span class="thumb"></span></span>
  </button>
{/snippet}

{#snippet knob(def: ParamDef)}
  {@const v = paramView(s, def)}
  {@const off = def.display?.rawOffset ?? 0}
  <Knob
    label={def.label}
    value={v.value === undefined ? undefined : v.value - off}
    stored={v.stored === null ? null : v.stored - off}
    min={def.min - off}
    max={def.max - off}
    step={def.dragStep ?? 1}
    format={format(def)}
    enabled={editable(s, def)}
    onchange={(x) => set(def, x + off)}
    onreset={() => void reset(def)}
  />
{/snippet}

{#snippet choice(def: ParamDef)}
  {@const v = paramView(s, def)}
  {@const names = def.display?.table ?? []}
  <div class="choice">
    <div class="seg" class:changed={v.changed} role="radiogroup" aria-label={def.label}>
      {#each names as name, i (name)}
        <button
          role="radio"
          aria-checked={v.value === i}
          class:sel={v.value === i}
          disabled={!editable(s, def)}
          onclick={() => set(def, i)}>{name}</button
        >
      {/each}
    </div>
    <span class="clabel">{def.label}</span>
  </div>
{/snippet}

{#snippet back(title: string, on: boolean | undefined, def: ParamDef)}
  <div class="top">
    <button class="back" onclick={() => (open = null)} aria-label={t(lang, 'fx.back')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
    </button>
    <h2>{title}</h2>
    {@render toggle(on, title, true, def)}
  </div>
{/snippet}

<div class="page" class:dim={dimmed(s)}>
  {#if row}
    {@const r: EffectRow = row}
    {@const params = activeParams(r)}
    {@const typeDef = r.colour === undefined ? null : effectType(r.group, r.colour)}
    <div style:--c={colourCss(r.colour)}>
      {@render back(r.label, r.on, r.group.switch)}
      <div class="sect"><span class="title">{t(lang, 'fx.variation')}</span><i></i></div>
      <div class="variations" role="radiogroup" aria-label={t(lang, 'fx.variation')}>
        {#each [0, 1, 2] as c (c)}
          <button
            class="var"
            class:sel={r.colour === c}
            class:changed={r.colour === c && r.colourChanged}
            role="radio"
            aria-checked={r.colour === c}
            style:--v={colourCss(c)}
            disabled={!editable(s, r.group.colour)}
            onclick={() => set(r.group.colour, c)}
          >
            <span class="vhead"><span class="vled"></span>{colourName(c)}</span>
            <span class="vtype" class:typechanged={r.typeChanged[c]}>
              <span class="tlabel">{t(lang, 'fx.type')}</span>
              {r.typeNames[c] ?? '–'}
            </span>
          </button>
        {/each}
      </div>
      <p class="note">{t(lang, 'fx.variationNote')}</p>

      {#if typeDef}
        <button
          class="typebtn"
          class:changed={r.colour !== undefined && r.typeChanged[r.colour]}
          aria-haspopup="dialog"
          disabled={!editable(s, typeDef)}
          onclick={() => (choosingType = true)}
        >
          <span class="tlabel"
            >{t(lang, 'fx.type')} · {r.colour === undefined ? '' : colourName(r.colour)}</span
          >
          <span class="tname">{r.colour === undefined ? '–' : (r.typeNames[r.colour] ?? '–')}</span>
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
        </button>
      {/if}

      {#if params.length > 0}
        <div class="sect"><span class="title">{t(lang, 'fx.knobs')}</span><i></i></div>
        <div class="knobs">
          {#each params.filter((p) => p.control === 'knob') as def (def.key)}
            {@render knob(def)}
          {/each}
        </div>
        {#each params.filter((p) => p.control !== 'knob') as def (def.key)}
          {#if def.control === 'switch'}
            {@const v = paramView(s, def)}
            <div class="row">
              <span class="rlabel" class:changed={v.changed}>{def.label}</span>
              {@render toggle(v.value === undefined ? undefined : v.value === 1, def.label, true, def)}
            </div>
          {:else}
            {@render choice(def)}
          {/if}
        {/each}
      {:else if r.key === 'mod' || r.key === 'fx'}
        <p class="note">{t(lang, 'fx.knobsLaterPhase2')}</p>
      {/if}
    </div>

    {#if choosingType && typeDef}
      <Sheet
        title={`${r.label} · ${t(lang, 'fx.type')}`}
        closeLabel={t(lang, 'sheet.close')}
        onClose={() => (choosingType = false)}
      >
        <div class="types" role="radiogroup" aria-label={t(lang, 'fx.type')}>
          {#each r.group.typeNames as name, i (name)}
            {@const current = r.colour === undefined ? undefined : r.types[r.colour]}
            <button
              role="radio"
              aria-checked={current === i}
              class:sel={current === i}
              disabled={!editable(s, typeDef)}
              onclick={() => chooseType(r, i)}>{name}</button
            >
          {/each}
        </div>
      </Sheet>
    {/if}
  {:else if open === 'ns'}
    {@render back(NS_SWITCH.label, ns.value === undefined ? undefined : ns.value === 1, NS_SWITCH)}
    <div class="sect"><span class="title">{NS_SWITCH.label}</span><i></i></div>
    <div class="knobs">
      {@render knob(NS_THRESHOLD)}
      {@render knob(NS_RELEASE)}
    </div>
    <p class="note">{t(lang, 'fx.nsNote')}</p>
  {:else}
    <div class="sect"><span class="title">{t(lang, 'fx.title')}</span><i></i></div>
    <ul class="list">
      {#each rows as r (r.key)}
        <li class:on={r.on} style:--c={colourCss(r.colour)}>
          <button class="open" onclick={() => (open = r.key)}>
            <span class="led"></span>
            <span class="text">
              <span class="name"
                >{r.label}{#if r.changed}<span class="mark"></span>{/if}</span
              >
              <span class="sub">
                {#if r.colour !== undefined}
                  <span class="swatch">{colourName(r.colour)}</span>{r.typeNames[r.colour] ?? ''}
                {/if}
              </span>
            </span>
            <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
          </button>
          {@render toggle(r.on, r.label, false, r.group.switch)}
        </li>
      {/each}
      <li class:on={ns.value === 1} style:--c="var(--accent)">
        <button class="open" onclick={() => (open = 'ns')}>
          <span class="led"></span>
          <span class="text">
            <span class="name"
              >{NS_SWITCH.label}{#if nsChanged}<span class="mark"></span>{/if}</span
            >
            <span class="sub">
              {NS_THRESHOLD.label}
              {paramView(s, NS_THRESHOLD).value ?? '–'} · {NS_RELEASE.label}
              {paramView(s, NS_RELEASE).value ?? '–'}
            </span>
          </span>
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
        </button>
        {@render toggle(
          ns.value === undefined ? undefined : ns.value === 1,
          NS_SWITCH.label,
          false,
          NS_SWITCH,
        )}
      </li>
    </ul>
    <p class="note">{t(lang, 'fx.note')}</p>
    {#if typeNamesMissing}
      <p class="note">{t(lang, 'fx.typeNamesLater')}</p>
    {/if}
  {/if}
</div>

<style>
  .page {
    padding: 0 14px 12px;
  }
  .dim {
    opacity: 0.45;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-radius: 14px;
    background: var(--panel-2);
    overflow: hidden;
  }
  li + li {
    border-top: 1px solid var(--line);
  }
  li {
    display: flex;
    align-items: center;
    padding-right: 12px;
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 66px;
    padding: 0 10px 0 16px;
    text-align: left;
    background: none;
    border-radius: 0;
  }
  .led {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--led-off);
    flex: none;
  }
  .on .led {
    background: var(--c);
    box-shadow: 0 0 8px 1px var(--c);
  }
  .text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 1.05rem;
    font-weight: 600;
  }
  .mark {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--warn);
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 0.82rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .swatch {
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--c);
  }
  .chev {
    width: 18px;
    height: 18px;
    flex: none;
    fill: none;
    stroke: var(--faint);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--muted);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .switch.on {
    color: var(--fg);
  }
  .track {
    position: relative;
    width: 46px;
    height: 26px;
    border-radius: 13px;
    background: var(--track);
  }
  .thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--muted);
  }
  .on .track {
    background: color-mix(in srgb, var(--c) 40%, transparent);
  }
  .on .thumb {
    left: 23px;
    background: var(--c);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 52px;
  }
  .back {
    display: grid;
    place-items: center;
    width: 44px;
    min-height: 44px;
    padding: 0;
    margin-left: -8px;
    background: none;
  }
  .back svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 1.45rem;
    font-weight: 700;
  }
  .variations {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-radius: 12px;
    background: var(--panel-2);
    overflow: hidden;
  }
  .var {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 76px;
    padding: 10px 12px;
    box-shadow: inset 0 -2px 0 transparent;
  }
  .var + .var {
    border-left: 1px solid var(--line);
  }
  .var.sel {
    background: color-mix(in srgb, var(--v) 10%, transparent);
    box-shadow: inset 0 -2px 0 var(--v);
  }
  .vhead {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--faint);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .sel .vhead {
    color: var(--v);
  }
  .vled {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--led-off);
  }
  .sel .vled {
    background: var(--v);
    box-shadow: 0 0 6px 1px var(--v);
  }
  .var.changed .vled {
    outline: 2px solid var(--warn);
    outline-offset: 1px;
  }
  .vtype {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--muted);
  }
  .sel .vtype {
    color: var(--fg);
  }
  .vtype.typechanged {
    color: var(--warn);
  }
  .tlabel {
    color: var(--faint);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .knobs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0 4px;
  }
  .note {
    color: var(--faint);
    font-size: 0.8rem;
    line-height: 1.45;
    margin: 10px 4px 0;
  }
  /* Switches and variations are buttons since 1b: no button look; not dimmed when locked (the page dims). */
  button.switch {
    background: none;
    border: none;
    min-height: 44px;
    padding: 0 0 0 8px;
  }
  button.var {
    align-items: stretch;
    text-align: left;
    background: none;
    border: none;
    border-radius: 0;
    color: inherit;
  }
  button.switch:disabled,
  button.var:disabled {
    opacity: 1;
  }
  .typebtn {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 2px 8px;
    margin-top: 12px;
    padding: 10px 12px 10px 16px;
    text-align: left;
    background: var(--panel-2);
  }
  .typebtn .tlabel {
    grid-column: 1;
  }
  .typebtn .tname {
    grid-column: 1;
    font-size: 1.1rem;
    font-weight: 700;
  }
  .typebtn .chev {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
  .typebtn.changed .tname {
    color: var(--warn);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 48px;
    padding: 0 4px;
    border-top: 1px solid var(--line);
  }
  .rlabel,
  .clabel {
    color: var(--muted);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .rlabel.changed {
    color: var(--warn);
  }
  .choice {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 4px;
    border-top: 1px solid var(--line);
  }
  .seg {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 6px;
  }
  .seg button {
    min-height: 44px;
    padding: 0 6px;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .seg button.sel {
    border-color: var(--c, var(--accent));
    color: var(--fg);
  }
  .seg.changed button.sel {
    border-color: var(--warn);
  }
  .types {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    max-height: 60vh;
    overflow-y: auto;
  }
  .types button {
    min-height: 48px;
    padding: 0 10px;
    text-align: left;
    font-size: 0.9rem;
  }
  .types button.sel {
    border-color: var(--c, var(--accent));
    color: var(--c, var(--accent));
    font-weight: 700;
  }
</style>
