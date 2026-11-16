<script lang="ts">
  // Effects tab, direction C (PLAN 5, design round): one list with on/off, active variation and its type; a tap
  // opens the effect page with all three variations. Phase 1a only shows; knobs come with 1b (booster, delay,
  // reverb) and Phase 2 (mod, fx).
  import { NS_RELEASE, NS_SWITCH, NS_THRESHOLD } from '../model/params';
  import type { ParamDef } from '../model/schema';
  import type { ConnectionState } from '../state/connection';
  import Knob from './Knob.svelte';
  import { t, type Language, type TextKey } from './i18n';
  import { dimmed, effectRows, paramView, type EffectRow } from './view';

  let { s, lang }: { s: ConnectionState; lang: Language } = $props();
  /** Key of the effect whose page is open; 'ns' for the noise suppressor. */
  let open = $state<string | null>(null);

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
</script>

{#snippet toggle(on: boolean | undefined, label: string, withState: boolean)}
  <span
    class="switch"
    class:on
    role="switch"
    aria-checked={on === true}
    aria-readonly="true"
    aria-label={label}
  >
    {#if withState}<span class="state">{on ? t(lang, 'fx.on') : t(lang, 'fx.off')}</span>{/if}
    <span class="track"><span class="thumb"></span></span>
  </span>
{/snippet}

{#snippet knob(def: ParamDef)}
  {@const v = paramView(s, def)}
  <Knob label={def.label} value={v.value} stored={v.stored} min={def.min} max={def.max} />
{/snippet}

{#snippet back(title: string, on: boolean | undefined)}
  <div class="top">
    <button class="back" onclick={() => (open = null)} aria-label={t(lang, 'fx.back')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
    </button>
    <h2>{title}</h2>
    {@render toggle(on, title, true)}
  </div>
{/snippet}

<div class="page" class:dim={dimmed(s)}>
  {#if row}
    {@const r: EffectRow = row}
    <div style:--c={colourCss(r.colour)}>
      {@render back(r.label, r.on)}
      <div class="sect"><span class="title">{t(lang, 'fx.variation')}</span><i></i></div>
      <div class="variations" role="radiogroup" aria-label={t(lang, 'fx.variation')} aria-readonly="true">
        {#each [0, 1, 2] as c (c)}
          <span
            class="var"
            class:sel={r.colour === c}
            class:changed={r.colour === c && r.colourChanged}
            role="radio"
            aria-checked={r.colour === c}
            style:--v={colourCss(c)}
          >
            <span class="vhead"><span class="vled"></span>{colourName(c)}</span>
            <span class="vtype" class:typechanged={r.typeChanged[c]}>
              <span class="tlabel">{t(lang, 'fx.type')}</span>
              {r.typeNames[c] ?? '–'}
            </span>
          </span>
        {/each}
      </div>
      <p class="note">{t(lang, 'fx.variationNote')}</p>
      <p class="note">
        {r.key === 'mod' || r.key === 'fx' ? t(lang, 'fx.knobsLaterPhase2') : t(lang, 'fx.knobsLater1b')}
      </p>
      {#if r.group.typeNames.length === 0}
        <p class="note">{t(lang, 'fx.typeNamesLater')}</p>
      {/if}
    </div>
  {:else if open === 'ns'}
    {@render back(NS_SWITCH.label, ns.value === undefined ? undefined : ns.value === 1)}
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
            {@render toggle(r.on, r.label, false)}
            <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
          </button>
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
          {@render toggle(ns.value === undefined ? undefined : ns.value === 1, NS_SWITCH.label, false)}
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
        </button>
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
  .open {
    width: 100%;
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
</style>
