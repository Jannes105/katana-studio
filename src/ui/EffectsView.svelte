<script lang="ts">
  // Effects tab, direction C (PLAN 5, design round): one list with on/off, active variation and its type; a tap
  // opens the effect page with all three variations. Everything here writes: on/off, active variation, type, and
  // the knobs of the active variation's type, on pages of at most six knobs (Phase 2, direction A). The delay
  // page has a second tab for Delay 2 (variation = reverb colour); layer mode sits on the reverb page.
  import type { ChainBlock, ChainSettings } from '../model/chain';
  import {
    AMP_TYPE,
    DELAY2,
    DELAY2_SWITCH,
    NS_RELEASE,
    NS_SWITCH,
    NS_THRESHOLD,
    effectType,
  } from '../model/params';
  import { readRaw } from '../model/patch';
  import {
    CHAIN_VARIANT,
    MASTER_KEY,
    SECTIONS,
    sectionByKey,
    type Section,
    type SectionKey,
  } from '../model/sections';
  import ChainDiagram, { type BlockInfo } from './ChainDiagram.svelte';
  import { instanceParam, type ParamDef, type VariantGroup } from '../model/schema';
  import { effectLayout, type EffectPage } from './pages';
  import type { AmpConnection, ConnectionState, WriteResult } from '../state/connection';
  import Knob from './Knob.svelte';
  import Sheet from './Sheet.svelte';
  import { onBack } from './back';
  import { paramHelp, typeKey, type HelpTarget } from './help/help';
  import { longPress } from './help/press';
  import { openHelp } from './help/state.svelte';
  import { t, type Language, type TextKey } from './i18n';
  import {
    chainSettings,
    dimmed,
    editable,
    effectRows,
    paramView,
    type ChainItem,
    type EffectRow,
  } from './view';

  let {
    s,
    lang,
    connection,
    onUndoable,
    view = 'effects',
  }: {
    s: ConnectionState;
    lang: Language;
    connection: AmpConnection;
    /** A reset happened: the app offers "Undo" for a moment (PLAN 4.5 rule 7). */
    onUndoable: (text: string, result: WriteResult) => void;
    /** Effects tab (the five effects and the noise suppressor) or chain tab (every block in signal order). */
    view?: 'effects' | 'chain';
  } = $props();
  /** Key of the page that is open: an effect, a section (EQ, pedal FX …), 'chain' or 'ns'. */
  let open = $state<string | null>(null);
  /** The type list of this group and variation is open. */
  let choosingType = $state<{ group: VariantGroup; colour: number } | null>(null);
  /** A choice with more than four options is open as a list. */
  let choosingValue = $state<ParamDef | null>(null);
  /** Page of the effect page (direction A) and the tab of the delay page. */
  let page = $state(0);
  let delayTab = $state<'delay' | 'delay2'>('delay');
  // The back button leads from an effect or section page back to the list.
  $effect(() => {
    if (open !== null) return onBack(() => (open = null));
  });
  const HARMONIST = 12;

  const COLOUR_CSS = ['var(--c-green)', 'var(--c-red)', 'var(--c-yellow)'] as const;
  const colourCss = (c: number | undefined) =>
    c === undefined ? 'var(--accent)' : (COLOUR_CSS[c] ?? 'var(--accent)');
  const colourName = (c: number) => t(lang, `colour.${c}` as TextKey);

  const rows = $derived(effectRows(s));
  const row = $derived(rows.find((r) => r.key === open));
  const sec = $derived(SECTIONS.find((x) => x.key === open));
  /** Names of the chain blocks (as on the amp; not translated). */
  const BLOCK_LABEL: Record<ChainBlock, string> = {
    pedalFx: 'Pedal FX',
    booster: 'Booster',
    mod: 'Mod',
    fx: 'FX',
    delay: 'Delay',
    eq1: 'EQ 1',
    eq2: 'EQ 2',
    amp: 'Amp',
    sendReturn: 'Send/Return',
    footVolume: 'FV',
    delay2: 'Delay 2',
    reverb: 'Reverb',
  };
  const chainIsChanged = $derived(
    paramView(s, CHAIN_VARIANT).changed ||
      SECTIONS.some((x) => x.position && paramView(s, x.position).changed),
  );
  /** What the chain tab shows for a block. */
  function blockInfo(b: ChainBlock): BlockInfo {
    const r = rows.find((x) => x.key === b);
    if (r)
      return {
        label: r.label,
        sub: r.colour === undefined ? '' : `${colourName(r.colour)} · ${r.typeNames[r.colour] ?? ''}`,
        on: r.on,
        hasSwitch: true,
        colour: colourCss(r.colour),
        changed: r.changed,
        hasPage: true,
      };
    const x = SECTIONS.find((y) => y.key === b);
    if (x) {
      const on = valueOf(x.switch);
      return {
        label: x.label,
        sub: sectionSub(x),
        on: on === undefined ? undefined : on === 1,
        hasSwitch: true,
        colour: 'var(--accent)',
        changed: sectionChanged(x),
        hasPage: true,
      };
    }
    if (b === 'delay2') {
      const reverb = rows.find((y) => y.key === 'reverb');
      const d2 = paramView(s, DELAY2_SWITCH);
      const typeDef = reverb?.colour === undefined ? undefined : effectType(DELAY2, reverb.colour);
      const type = valueOf(typeDef);
      return {
        label: DELAY2.label,
        sub: type === undefined ? '' : (DELAY2.typeNames[type] ?? ''),
        on: d2.value === undefined ? undefined : d2.value === 1,
        hasSwitch: true,
        colour: colourCss(reverb?.colour),
        changed: d2.changed || (typeDef !== undefined && paramView(s, typeDef).changed),
        hasPage: true,
      };
    }
    const at = valueOf(AMP_TYPE);
    return {
      label: BLOCK_LABEL[b],
      sub: b === 'amp' && at !== undefined ? (AMP_TYPE.display?.table?.[at] ?? '') : '',
      on: undefined,
      hasSwitch: false,
      colour: 'var(--accent)',
      changed: false,
      hasPage: false,
    };
  }
  /** Writes the settings of a drag or step: the chain variant or one position (only what changed). */
  function applyChain(next: ChainSettings): void {
    const now = chainSettings(s);
    if (next.variant !== now.variant) set(CHAIN_VARIANT, next.variant);
    for (const key of ['pedalFx', 'eq1', 'eq2', 'sendReturn'] as const) {
      const pos = sectionByKey(key).position;
      if (pos && next[key] !== now[key]) set(pos, next[key]);
    }
  }
  function toggleBlock(b: ChainBlock): void {
    const r = rows.find((x) => x.key === b);
    const def = r
      ? r.group.switch
      : b === 'delay2'
        ? DELAY2_SWITCH
        : SECTIONS.find((x) => x.key === b)?.switch;
    if (!def) return;
    set(def, valueOf(def) === 1 ? 0 : 1);
  }
  const valueOf = (def: ParamDef | undefined): number | undefined =>
    def ? paramView(s, def).value : undefined;
  /** A short summary for a section in the list. */
  function sectionSub(x: Section): string {
    const name = (def: ParamDef | undefined) => {
      const v = valueOf(def);
      return v === undefined || !def ? '–' : (def.display?.table?.[v] ?? String(v));
    };
    if (x.type) return name(x.type);
    if (x.key === 'sendReturn')
      return `${name(x.position)} · ${name(x.params.find((p) => p.key === 'sendReturn.mode'))}`;
    const level = x.params.find((p) => p.key === 'solo.level');
    return `${level?.label ?? ''} ${valueOf(level) ?? '–'}`;
  }
  const sectionChanged = (x: Section) => [x.switch, ...x.params].some((p) => paramView(s, p).changed);
  const ns = $derived(paramView(s, NS_SWITCH));
  const nsChanged = $derived(
    ns.changed || paramView(s, NS_THRESHOLD).changed || paramView(s, NS_RELEASE).changed,
  );
  const typeNamesMissing = $derived(rows.some((r) => r.group.typeNames.length === 0));

  /** Back to page 1 whenever the effect, its variation or its type changes. */
  const pageKey = $derived.by(() => {
    if (sec) return `${open}/${valueOf(sec.type) ?? ''}`;
    if (!row || row.colour === undefined) return `${open}`;
    return `${open}/${delayTab}/${row.colour}/${row.types[row.colour]}`;
  });
  $effect(() => {
    void pageKey;
    page = 0;
  });

  /** The layout of one variation: head choices and pages, with patch addresses (instanceParam). */
  function layoutOf(g: VariantGroup, colour: number, type: number | undefined) {
    const abs = (p: ParamDef): ParamDef => (p === MASTER_KEY ? p : instanceParam(g, colour, p));
    const valueOf = (key: string): number | undefined => {
      const p = g.params.find((q) => q.key === key);
      return p ? paramView(s, instanceParam(g, colour, p)).value : undefined;
    };
    const extra = (g.key === 'mod' || g.key === 'fx') && type === HARMONIST ? [MASTER_KEY] : [];
    const l = effectLayout(g.params, type, valueOf, extra);
    return {
      head: l.head.map(abs),
      pages: l.pages.map((p) => ({ ...p, choices: p.choices.map(abs), knobs: p.knobs.map(abs) })),
    };
  }
  /** The layout of a section (patch parameters; visibleFor follows its type). */
  function sectionLayout(x: Section) {
    const byKey = (key: string) => valueOf(x.params.find((p) => p.key === key));
    return effectLayout(x.params, valueOf(x.type), byKey);
  }
  function openItem(it: ChainItem | 'footVolume'): void {
    if (it === 'amp' || it === 'footVolume') return;
    if (it === 'delay2') {
      delayTab = 'delay2';
      open = 'delay';
      return;
    }
    if (it === 'delay') delayTab = 'delay';
    open = it;
  }
  function pageTitle(p: EffectPage, many: boolean): string {
    const name = p.group ?? (many ? t(lang, 'fx.mainPage') : t(lang, 'fx.knobs'));
    return p.part ? `${name} ${p.part.index}/${p.part.count}` : name;
  }

  // Swipe sideways between pages (knobs drag up/down, so a mostly horizontal move is a swipe).
  let swipe: { x: number; y: number } | null = null;
  function swipeStart(e: PointerEvent): void {
    swipe = (e.target as HTMLElement).closest('.knob, button') ? null : { x: e.clientX, y: e.clientY };
  }
  function swipeEnd(e: PointerEvent, count: number): void {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - swipe.y))
      page = Math.max(0, Math.min(count - 1, page + (dx < 0 ? 1 : -1)));
    swipe = null;
  }

  function set(def: ParamDef, raw: number): void {
    if (editable(s, def)) void connection.setValue(def, raw);
  }
  async function reset(def: ParamDef): Promise<void> {
    if (!editable(s, def)) return;
    const result = await connection.revertParam(def);
    if (result && result.previous.length > 0) onUndoable(t(lang, 'undo.reset', { name: def.label }), result);
  }
  function chooseType(type: number): void {
    if (choosingType) set(effectType(choosingType.group, choosingType.colour), type);
    choosingType = null;
  }

  const signed = (v: number): string => (v > 0 ? `+${v}` : String(v));

  // ---- Explanations (Phase 3a): a long press explains a control and changes nothing ----
  /** Where the open page belongs, shown above the title of an explanation: effect and type, or section. */
  const helpContext = $derived.by((): string | undefined => {
    if (row) {
      if (row.key === 'delay' && delayTab === 'delay2') return DELAY2.label;
      const name = row.colour === undefined ? undefined : row.typeNames[row.colour];
      return name ? `${row.label} · ${name}` : row.label;
    }
    return sec?.label ?? (open === 'ns' ? NS_SWITCH.label : undefined);
  });
  const explain =
    (def: ParamDef, title: string = def.label) =>
    () =>
      openHelp({ ...paramHelp(def, helpContext), title });
  /** Mod and FX share one list of types; Delay 2 uses the delay types. */
  const typeGroup = (g: VariantGroup): string =>
    g.key === 'mod' || g.key === 'fx' ? 'modfx' : g.key === 'delay2' ? 'delay' : g.key;
  function typeHelp(g: VariantGroup, name: string | undefined): HelpTarget {
    return name
      ? { key: typeKey(typeGroup(g), name), title: name, context: `${g.label} · ${t(lang, 'fx.type')}` }
      : { key: 'type', title: t(lang, 'fx.type'), context: g.label };
  }
  /** How a knob shows its value: name from the table, signed around a centre, with unit. */
  function format(def: ParamDef): (shown: number) => string {
    const off = def.display?.rawOffset ?? 0;
    const table = def.display?.table;
    const unit = def.display?.unit;
    return (v) => {
      if (table) return table[v + off] ?? String(v);
      const n = v * (def.display?.factor ?? 1);
      const digits = def.display?.decimals;
      const text = def.min - off < 0 ? signed(n) : digits === undefined ? String(n) : n.toFixed(digits);
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
    use:longPress={def ? explain(def, label) : undefined}
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
    help={paramHelp(def, helpContext)}
  />
{/snippet}

{#snippet choice(def: ParamDef, label: string = def.label)}
  {@const v = paramView(s, def)}
  {@const names = def.display?.table ?? []}
  {#if names.length > 4}
    <button
      class="pick"
      class:changed={v.changed}
      aria-haspopup="dialog"
      disabled={!editable(s, def)}
      use:longPress={explain(def, label)}
      onclick={() => (choosingValue = def)}
    >
      <span class="tlabel">{label}</span>
      <span class="pname">{v.value === undefined ? '–' : (names[v.value] ?? v.value)}</span>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
    </button>
  {:else}
    <div class="choice">
      <div class="seg" class:changed={v.changed} role="radiogroup" aria-label={def.label}>
        {#each names as name, i (name)}
          <button
            role="radio"
            aria-checked={v.value === i}
            class:sel={v.value === i}
            disabled={!editable(s, def)}
            use:longPress={explain(def, label)}
            onclick={() => set(def, i)}>{name}</button
          >
        {/each}
      </div>
      <span class="clabel">{label}</span>
    </div>
  {/if}
{/snippet}

{#snippet control(def: ParamDef)}
  {#if def.control === 'switch'}
    {@const v = paramView(s, def)}
    <div class="row">
      <span class="rlabel" class:changed={v.changed}>{def.label}</span>
      {@render toggle(v.value === undefined ? undefined : v.value === 1, def.label, true, def)}
    </div>
  {:else}
    {@render choice(def)}
  {/if}
{/snippet}

{#snippet typeButton(g: VariantGroup, colour: number | undefined, name: string | undefined, changed: boolean)}
  {#if colour !== undefined}
    {@const typeDef = effectType(g, colour)}
    <button
      class="typebtn"
      class:changed
      aria-haspopup="dialog"
      disabled={!editable(s, typeDef)}
      use:longPress={() => openHelp(typeHelp(g, name))}
      onclick={() => (choosingType = { group: g, colour })}
    >
      <span class="tlabel">{t(lang, 'fx.type')} · {colourName(colour)}</span>
      <span class="tname">{name ?? '–'}</span>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
    </button>
  {/if}
{/snippet}

{#snippet variantBody(g: VariantGroup, colour: number | undefined, type: number | undefined)}
  {#if colour !== undefined}
    {@render layoutView(layoutOf(g, colour, type))}
  {/if}
{/snippet}

{#snippet layoutView(l: { head: readonly ParamDef[]; pages: readonly EffectPage[] })}
  {#if true}
    {@const many = l.pages.length > 1}
    {@const current = l.pages[Math.min(page, l.pages.length - 1)]}
    <div class="vb" style:--rows={l.head.length + (current?.choices.length ?? 0)}>
      {#each l.head as def (def.key)}
        {@render control(def)}
      {/each}
      {#if current}
        {#if many}
          <div class="pagebar">
            <button
              class="arrow"
              disabled={page === 0}
              onclick={() => page--}
              aria-label={t(lang, 'fx.prevPage')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <div class="tabs" role="tablist" aria-label={t(lang, 'fx.pages')}>
              {#each l.pages as p, i (pageTitle(p, many))}
                <button
                  role="tab"
                  aria-selected={i === page}
                  class:sel={i === page}
                  onclick={() => (page = i)}>{pageTitle(p, many)}</button
                >
              {/each}
            </div>
            <button
              class="arrow"
              disabled={page >= l.pages.length - 1}
              onclick={() => page++}
              aria-label={t(lang, 'fx.nextPage')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
        {:else}
          <div class="sect"><span class="title">{t(lang, 'fx.knobs')}</span><i></i></div>
        {/if}
        <div
          class="fxpage"
          role="tabpanel"
          tabindex="-1"
          aria-label={pageTitle(current, many)}
          onpointerdown={swipeStart}
          onpointerup={(e) => swipeEnd(e, l.pages.length)}
        >
          {#each current.choices as def (def.key)}
            {@render control(def)}
          {/each}
          {#if current.knobs.length > 0}
            <div class="knobs">
              {#each current.knobs as def (def.key)}
                {@render knob(def)}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet sectionRow(key: SectionKey)}
  {@const x = SECTIONS.find((y) => y.key === key)}
  {#if x}
    {@const on = valueOf(x.switch)}
    <li class:on={on === 1} style:--c="var(--accent)">
      <button class="open" onclick={() => (open = x.key)}>
        <span class="led"></span>
        <span class="text">
          <span class="name"
            >{x.label}{#if sectionChanged(x)}<span class="mark"></span>{/if}</span
          >
          <span class="sub">{sectionSub(x)}</span>
        </span>
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
      </button>
      {@render toggle(on === undefined ? undefined : on === 1, x.label, false, x.switch)}
    </li>
  {/if}
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
    {@const reverb = rows.find((x) => x.key === 'reverb')}
    {@const d2Colour = reverb?.colour}
    {@const d2Type = d2Colour === undefined ? undefined : readRaw(s.current, effectType(DELAY2, d2Colour))}
    {@const d2 = paramView(s, DELAY2_SWITCH)}
    <div class="fx" class:withtabs={r.key === 'delay'} style:--c={colourCss(r.colour)}>
      {@render back(r.label, r.on, r.group.switch)}
      {#if r.key === 'delay'}
        <div class="seg dtabs" role="tablist" aria-label={r.label}>
          <button
            role="tab"
            aria-selected={delayTab === 'delay'}
            class:sel={delayTab === 'delay'}
            onclick={() => (delayTab = 'delay')}>{r.label}</button
          >
          <button
            role="tab"
            aria-selected={delayTab === 'delay2'}
            class:sel={delayTab === 'delay2'}
            onclick={() => (delayTab = 'delay2')}>{DELAY2.label}</button
          >
        </div>
      {/if}
      {#if r.key === 'delay' && delayTab === 'delay2'}
        <div class="row">
          <span class="rlabel" class:changed={d2.changed}>{DELAY2.label}</span>
          {@render toggle(
            d2.value === undefined ? undefined : d2.value === 1,
            DELAY2.label,
            true,
            DELAY2_SWITCH,
          )}
        </div>
        <p class="note d2note">
          {t(lang, 'fx.delay2Note', { colour: d2Colour === undefined ? '–' : colourName(d2Colour) })}
        </p>
        {@render typeButton(
          DELAY2,
          d2Colour,
          d2Type === undefined ? undefined : DELAY2.typeNames[d2Type],
          d2Colour !== undefined && paramView(s, effectType(DELAY2, d2Colour)).changed,
        )}
        {@render variantBody(DELAY2, d2Colour, d2Type)}
      {:else}
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
              use:longPress={explain(r.group.colour)}
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
        <p class="note tall">{t(lang, 'fx.variationNote')}</p>
        {@render typeButton(
          r.group,
          r.colour,
          r.colour === undefined ? undefined : r.typeNames[r.colour],
          r.colour !== undefined && r.typeChanged[r.colour] === true,
        )}
        {@render variantBody(r.group, r.colour, r.colour === undefined ? undefined : r.types[r.colour])}
      {/if}
    </div>

    {#if choosingType}
      {@const ct = choosingType}
      {@const typeDef = effectType(ct.group, ct.colour)}
      {@const current = paramView(s, typeDef).value}
      <Sheet
        title={`${ct.group.label} · ${t(lang, 'fx.type')}`}
        closeLabel={t(lang, 'sheet.close')}
        onClose={() => (choosingType = null)}
      >
        <div class="types" role="radiogroup" aria-label={t(lang, 'fx.type')}>
          {#each ct.group.typeNames as name, i (name)}
            <button
              role="radio"
              aria-checked={current === i}
              class:sel={current === i}
              disabled={!editable(s, typeDef)}
              use:longPress={() => openHelp(typeHelp(ct.group, name))}
              onclick={() => chooseType(i)}>{name}</button
            >
          {/each}
        </div>
      </Sheet>
    {/if}
    {#if choosingValue}
      {@const cv = choosingValue}
      {@const current = paramView(s, cv).value}
      <Sheet title={cv.label} closeLabel={t(lang, 'sheet.close')} onClose={() => (choosingValue = null)}>
        <div class="types" role="radiogroup" aria-label={cv.label}>
          {#each cv.display?.table ?? [] as name, i (name)}
            <button
              role="radio"
              aria-checked={current === i}
              class:sel={current === i}
              disabled={!editable(s, cv)}
              onclick={() => {
                set(cv, i);
                choosingValue = null;
              }}>{name}</button
            >
          {/each}
        </div>
      </Sheet>
    {/if}
  {:else if sec}
    {@const x: Section = sec}
    {@const on = valueOf(x.switch)}
    {@render back(x.label, on === undefined ? undefined : on === 1, x.switch)}
    <div class="fx">
      {@render layoutView(sectionLayout(x))}
    </div>
  {:else if open === 'ns'}
    {@render back(NS_SWITCH.label, ns.value === undefined ? undefined : ns.value === 1, NS_SWITCH)}
    <div class="sect"><span class="title">{NS_SWITCH.label}</span><i></i></div>
    <div class="knobs">
      {@render knob(NS_THRESHOLD)}
      {@render knob(NS_RELEASE)}
    </div>
    <p class="note">{t(lang, 'fx.nsNote')}</p>
  {:else}
    {#if view === 'chain'}
      <ChainDiagram
        settings={chainSettings(s)}
        info={blockInfo}
        {lang}
        enabled={editable(s, CHAIN_VARIANT)}
        chainChanged={chainIsChanged}
        onapply={applyChain}
        onopen={(b) => openItem(b)}
        ontoggle={toggleBlock}
      >
        <ul class="list" style:--n={12}>{@render sectionRow('solo')}</ul>
      </ChainDiagram>
    {:else}
      <ul class="list" style:--n={7}>
        {#each rows as r (r.key)}
          <li class:on={r.on} style:--c={colourCss(r.colour)}>
            <button
              class="open"
              use:longPress={() =>
                openHelp(typeHelp(r.group, r.colour === undefined ? undefined : r.typeNames[r.colour]))}
              onclick={() => openItem(r.key)}
            >
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
        <li class="gap" aria-hidden="true"></li>
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
    {/if}
    {#if typeNamesMissing}
      <p class="note">{t(lang, 'fx.typeNamesLater')}</p>
    {/if}
  {/if}
</div>

<style>
  .page {
    padding: 0 14px 12px;
  }
  /*
   * An effect page never needs scrolling (wish 2026-11-17, as the rehearsal tab): two rows of knobs take what is
   * left of the height of <main> (100cqh) after header, variations, type, page bar (--fixed) and the rows of
   * choices on the page (--rows, about 50 px each); a knob row is its circle plus 48 px for value and name. Knobs
   * between 46 and 100 px. The explanation shows only when there is room.
   */
  .fx {
    --fixed: 250px;
  }
  .fx.withtabs {
    --fixed: 306px;
  }
  .vb {
    --knob-max: clamp(46px, calc((100cqh - var(--fixed) - var(--rows) * 50px) / 2 - 48px), 100px);
  }
  .note.tall {
    display: none;
  }
  @container (min-height: 760px) {
    .note.tall {
      display: block;
    }
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-radius: 14px;
    background: var(--panel-2);
    overflow: hidden;
  }
  .list > li + li {
    border-top: 1px solid var(--line);
  }
  .list > li {
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
    min-height: 0;
    align-self: stretch;
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
    gap: 4px;
    min-height: 56px;
    padding: 8px 10px;
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
    margin-top: 8px;
    padding: 8px 12px 8px 16px;
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
  .pagebar {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    margin: 6px -8px 2px;
  }
  .tabs {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs button {
    min-height: 34px;
    padding: 4px 12px;
    font-size: 13px;
    white-space: nowrap;
    background: transparent;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 17px;
  }
  .tabs button.sel {
    color: var(--accent);
    border-color: var(--accent);
  }
  .fxpage {
    touch-action: pan-y;
    min-height: 120px;
  }
  .arrow {
    min-height: 44px;
    min-width: 52px;
    padding: 0;
    background: transparent;
  }
  .arrow svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: var(--fg);
    stroke-width: 2;
  }
  .pick {
    width: 100%;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    margin: 4px 0;
    text-align: left;
  }
  .pick.changed .pname {
    color: var(--warn);
  }
  .dtabs {
    margin: 4px 0 8px;
  }
  .dtabs button {
    flex: 1;
  }
  /* One row: label on the left, options on the right (fits the page height, Phase 2). */
  .choice {
    display: grid;
    grid-template-columns: minmax(72px, auto) 1fr;
    grid-template-areas: 'label seg';
    align-items: center;
    gap: 10px;
    padding: 4px 4px;
    border-top: 1px solid var(--line);
  }
  .choice .seg {
    grid-area: seg;
  }
  .choice .clabel {
    grid-area: label;
  }
  .seg {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 6px;
  }
  .seg button {
    min-height: 40px;
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
  /* The list fits the height too: rows share what is there (--n rows), between 40 and 60 px. */
  .list > li {
    min-height: clamp(40px, calc((100cqh - 40px) / var(--n, 14)), 60px);
  }
  .list > li.gap {
    min-height: 8px;
    background: var(--bg);
  }
  /* Small screens: flatter variations (no "Type" line), the type in one line, no Delay 2 hint. */
  @container (max-height: 600px) {
    .fx {
      --fixed: 246px;
    }
    .fx.withtabs {
      --fixed: 302px;
    }
    .var {
      min-height: 0;
      padding: 6px 10px;
    }
    .vtype .tlabel,
    .d2note {
      display: none;
    }
    .typebtn {
      grid-template-columns: auto 1fr auto;
      padding: 4px 12px 4px 16px;
    }
    .typebtn .tname {
      grid-column: 2;
      grid-row: 1;
      font-size: 1rem;
    }
    .typebtn .chev {
      grid-column: 3;
      grid-row: 1;
    }
    /* The list: name and type in one line, rows down to 32 px. */
    .list > li {
      min-height: clamp(32px, calc((100cqh - 48px) / var(--n, 14)), 60px);
    }
    .list .text {
      flex-direction: row;
      align-items: baseline;
      gap: 10px;
    }
    .list .name {
      font-size: 0.95rem;
    }
    .list .switch {
      min-height: 0;
      padding-top: 0;
      padding-bottom: 0;
    }
    .choice {
      padding: 2px 4px;
    }
  }
  .dim {
    opacity: 0.45;
  }
</style>
