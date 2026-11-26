<script lang="ts">
  // Control tab (Phase 3, direction B "own tab", decided 2026-11-17): what the effect knobs on the amp, the
  // expression inputs and the footswitches do in this patch. Three areas: amp knobs (target per effect, for mod
  // and FX the field of the active type), pedals (EXP pedal on the amp, GA-FC EXP 1–3: function, target and
  // the range from heel to toe) and switches (GA-FC function mode from SYSTEM, GA-FC FS1–3, footswitch on the
  // amp). A fourth area "System" (direction A, decided 2026-11-17) holds the SYSTEM sections: global EQ, line
  // out, USB, power amp in, MIDI; they apply to every channel and the amp stores them at once. Nothing scrolls.
  import {
    EXP_FUNCTIONS,
    EXP_INPUTS,
    FS_PARAMS,
    GAFC_FS_PARAMS,
    expField,
    fieldByKey,
    modFxField,
    type AssignField,
    type ExpInput,
  } from '../model/assigns';
  import { PATCH_PARAMS } from '../model/params';
  import { readRaw } from '../model/patch';
  import { effectiveRange, rangeOf, writable, type ParamDef, type RangeSpec } from '../model/schema';
  import { GAFC_SYSTEM_PARAMS } from '../model/system';
  import type { AmpConnection, ConnectionState, WriteResult } from '../state/connection';
  import Knob from './Knob.svelte';
  import Sheet from './Sheet.svelte';
  import { onBack } from './back';
  import { paramHelp } from './help/help';
  import { longPress } from './help/press';
  import { openHelp } from './help/state.svelte';
  import { t, type Language } from './i18n';
  import {
    SECTION_LABEL,
    SYSTEM_SECTIONS,
    systemLayout,
    systemParam,
    type SystemSection,
  } from './system-pages';
  import { canEdit, editable, effectRows, paramView } from './view';

  let {
    s,
    lang,
    connection,
    onUndoable,
  }: {
    s: ConnectionState;
    lang: Language;
    connection: AmpConnection;
    onUndoable: (text: string, result: WriteResult) => void;
  } = $props();

  type Area = 'knobs' | 'pedals' | 'switches' | 'system';
  let area = $state<Area>('knobs');
  let input = $state<ExpInput | null>(null);
  /** A list of values is open; `system` for a SYSTEM parameter. */
  let choosing = $state<{ def: ParamDef; title: string; system?: boolean } | null>(null);
  let section = $state<SystemSection | null>(null);
  let sysPage = $state(0);
  // The back button leads from a pedal or SYSTEM page back to the areas.
  $effect(() => {
    if (input !== null) return onBack(() => (input = null));
  });
  $effect(() => {
    if (section !== null) return onBack(() => (section = null));
  });

  // ---- SYSTEM (read once after connecting; no stored slot, so nothing is "unsaved") ----
  const sysValue = (key: string): number | undefined => readRaw(s.system, systemParam(key));
  const sysRaw = (def: ParamDef): number | undefined => readRaw(s.system, def);
  const sysEditable = (def: ParamDef): boolean => canEdit(s) && writable(def) && s.system.complete;
  function setSys(def: ParamDef, raw: number): void {
    if (sysEditable(def)) void connection.setSystemValue(def, raw);
  }
  const sysName = (def: ParamDef): string => {
    const v = sysRaw(def);
    return v === undefined ? '–' : (def.display?.table?.[v] ?? String(v));
  };
  const onOff = (key: string) => (sysValue(key) === 1 ? t(lang, 'fx.on') : t(lang, 'fx.off'));
  function sectionSummary(sec: SystemSection): string {
    if (!s.system.complete) return '–';
    switch (sec) {
      case 'globalEq': {
        const m = (sysValue('system.globalEq.select') ?? 0) + 1;
        return `${onOff('system.globalEq.on')} · ${m} · ${sysName(systemParam(`system.globalEq.${m}.type`))} · ${sysName(systemParam(`system.globalEq.${m}.position`))}`;
      }
      case 'lineOut':
        return `Air Feel ${sysName(systemParam('system.lineOut.airFeel'))} · Custom ${onOff('system.lineOut.custom')}`;
      case 'usb':
        return `Out ${(sysValue('system.usb.outLevel') ?? 0) * 2} % · Loop Back ${onOff('system.usb.loopback')}`;
      case 'powerAmpIn':
        return `HPF ${sysName(systemParam('system.powerAmpIn.hpfType'))}`;
      case 'midi':
        return sysName(systemParam('system.midi.channel'));
    }
  }
  const layout = $derived(section ? systemLayout(section, sysValue) : null);
  $effect(() => {
    void section;
    void sysValue('system.globalEq.select');
    void sysValue('system.lineOut.select');
    sysPage = 0;
  });

  const byKey = new Map(PATCH_PARAMS.map((p) => [p.key, p] as const));
  const P = (key: string): ParamDef => {
    const p = byKey.get(key);
    if (!p) throw new Error(`No parameter ${key}`);
    return p;
  };
  const value = (key: string): number | undefined => {
    const p = byKey.get(key);
    return p ? paramView(s, p).value : undefined;
  };

  const rows = $derived(effectRows(s));
  /** Raw type of the active variation of mod or FX. */
  const activeType = (key: 'mod' | 'fx'): number | undefined => {
    const r = rows.find((x) => x.key === key);
    return r?.colour === undefined ? undefined : r.types[r.colour];
  };
  /** The five effects with the field their knob on the amp uses now. */
  const knobRows = $derived(
    rows.map((r) => {
      const type = r.colour === undefined ? undefined : r.types[r.colour];
      const field: AssignField | undefined =
        r.key === 'mod' || r.key === 'fx'
          ? type === undefined
            ? undefined
            : modFxField(type)
          : fieldByKey(r.key);
      return {
        key: r.key,
        label: r.group.label,
        typeName: type === undefined ? '' : (r.group.typeNames[type] ?? ''),
        field,
      };
    }),
  );
  const fieldOf = (i: ExpInput): AssignField | undefined =>
    expField(value(`assign.${i.key}.function`) ?? -1, activeType('mod'), activeType('fx'));

  function format(r: RangeSpec): (shown: number) => string {
    const off = r.display?.rawOffset ?? 0;
    return (x) => {
      if (r.display?.table) return r.display.table[x + off] ?? String(x);
      const n = x * (r.display?.factor ?? 1);
      const num = r.display?.decimals === undefined ? String(n) : n.toFixed(r.display.decimals);
      // Signed around a centre (gains ±20 dB), as on the effect pages.
      const text = r.min - off < 0 && n > 0 ? `+${num}` : num;
      return r.display?.unit ? `${text} ${r.display.unit}` : text;
    };
  }
  const clampTo = (r: RangeSpec, x: number) => Math.min(r.max, Math.max(r.min, x));
  const nameOf = (def: ParamDef): string => {
    const v = paramView(s, def).value;
    return v === undefined ? '–' : (def.display?.table?.[v] ?? String(v));
  };
  /** Short line for a pedal: function, target and range. */
  function summary(i: ExpInput): { text: string; range: string } {
    const fn = EXP_FUNCTIONS[value(`assign.${i.key}.function`) ?? -1] ?? '–';
    const f = fieldOf(i);
    if (!f) return { text: fn, range: '' };
    const prefix = `assign.${i.key}.${f.key}`;
    const min = P(`${prefix}.min`);
    const r = effectiveRange(min, value);
    const show = format(r);
    const off = r.display?.rawOffset ?? 0;
    const lo = value(min.key);
    const hi = value(`${prefix}.max`);
    return {
      text: `${fn} · ${nameOf(P(`${prefix}.target`))}`,
      range:
        lo === undefined || hi === undefined
          ? ''
          : `${show(clampTo(r, lo) - off)} – ${show(clampTo(r, hi) - off)}`,
    };
  }

  function set(def: ParamDef, raw: number): void {
    if (editable(s, def)) void connection.setValue(def, raw);
  }
  async function reset(def: ParamDef): Promise<void> {
    if (!editable(s, def)) return;
    const result = await connection.revertParam(def);
    if (result && result.previous.length > 0) onUndoable(t(lang, 'undo.reset', { name: def.label }), result);
  }
  /** Long press handler (Phase 3a): explain a parameter, shown with this title and context. */
  const explain = (def: ParamDef, title: string, context?: string) => () =>
    openHelp({ ...paramHelp(def, context), title });
  const AREAS: readonly [Area, 'ctl.knobs' | 'ctl.pedals' | 'ctl.switches' | 'ctl.system'][] = [
    ['knobs', 'ctl.knobs'],
    ['pedals', 'ctl.pedals'],
    ['switches', 'ctl.switches'],
    ['system', 'ctl.system'],
  ];
</script>

{#snippet pick(def: ParamDef, label: string, sub: string = '')}
  {@const v = paramView(s, def)}
  <button
    class="pick"
    class:changed={v.changed}
    aria-haspopup="dialog"
    disabled={!editable(s, def)}
    use:longPress={explain(def, label, sub || undefined)}
    onclick={() => (choosing = { def, title: sub ? `${label} · ${sub}` : label })}
  >
    <span class="plabel"
      >{label}{#if sub}<span class="psub">&nbsp;· {sub}</span>{/if}</span
    >
    <span class="pname">{nameOf(def)}</span>
    <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
  </button>
{/snippet}

{#snippet limit(def: ParamDef)}
  {@const v = paramView(s, def)}
  {@const r = effectiveRange(def, value)}
  {@const off = r.display?.rawOffset ?? 0}
  <Knob
    label={def.label}
    value={v.value === undefined ? undefined : clampTo(r, v.value) - off}
    stored={v.stored === null ? null : clampTo(r, v.stored) - off}
    min={r.min - off}
    max={r.max - off}
    step={r.max - r.min > 300 ? 5 : 1}
    format={format(r)}
    enabled={editable(s, def)}
    onchange={(x) => set(def, x + off)}
    onreset={() => void reset(def)}
    help={paramHelp(def)}
  />
{/snippet}

{#snippet sysPick(def: ParamDef, label: string = def.label)}
  <button
    class="pick"
    aria-haspopup="dialog"
    disabled={!sysEditable(def)}
    use:longPress={explain(def, label, t(lang, 'ctl.system'))}
    onclick={() => (choosing = { def, title: label, system: true })}
  >
    <span class="plabel">{label}</span>
    <span class="pname">{sysName(def)}</span>
    <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
  </button>
{/snippet}

{#snippet sysKnob(def: ParamDef)}
  {@const r = rangeOf(def)}
  {@const off = r.display?.rawOffset ?? 0}
  {@const v = sysRaw(def)}
  <Knob
    label={def.label}
    value={v === undefined ? undefined : v - off}
    min={r.min - off}
    max={r.max - off}
    format={format(r)}
    enabled={sysEditable(def)}
    onchange={(x) => setSys(def, x + off)}
    help={paramHelp(def, t(lang, 'ctl.system'))}
  />
{/snippet}

{#snippet systemPage(sec: SystemSection, l: NonNullable<typeof layout>)}
  {@const current = l.pages[Math.min(sysPage, l.pages.length - 1)]}
  <div class="head">
    <button class="back" onclick={() => (section = null)} aria-label={t(lang, 'ctl.back')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
    </button>
    <h2>{SECTION_LABEL[sec]}</h2>
  </div>
  <p class="warn">{t(lang, 'ctl.systemNote')}</p>
  {#if sec === 'globalEq'}
    {@const on = systemParam('system.globalEq.on')}
    {@const sel = systemParam('system.globalEq.select')}
    <div class="grid">
      <button
        class="pick toggle"
        class:on={sysRaw(on) === 1}
        role="switch"
        aria-checked={sysRaw(on) === 1}
        disabled={!sysEditable(on)}
        use:longPress={explain(on, on.label, t(lang, 'ctl.system'))}
        onclick={() => setSys(on, sysRaw(on) === 1 ? 0 : 1)}
      >
        <span class="plabel">{on.label}</span>
        <span class="pname">{onOff('system.globalEq.on')}</span>
      </button>
      <div class="seg" role="radiogroup" aria-label={sel.label}>
        {#each sel.display?.table ?? [] as name, i (name)}
          <button
            role="radio"
            aria-checked={sysRaw(sel) === i}
            class:sel={sysRaw(sel) === i}
            disabled={!sysEditable(sel)}
            use:longPress={explain(sel, sel.label, t(lang, 'ctl.system'))}
            onclick={() => setSys(sel, i)}>{name}</button
          >
        {/each}
      </div>
    </div>
  {/if}
  <div class:grid={l.head.length >= 2}>
    {#each l.head as def (def.key)}
      {@render sysPick(def)}
    {/each}
  </div>
  {#if current}
    {#if l.pages.length > 1}
      <div class="pages" role="tablist">
        {#each l.pages as p, i (p.title)}
          <button
            role="tab"
            aria-selected={i === sysPage}
            class:sel={i === sysPage}
            onclick={() => (sysPage = i)}>{p.title}</button
          >
        {/each}
      </div>
    {/if}
    {#if current.choices.length}
      <div class="grid">
        {#each current.choices as def (def.key)}
          {@render sysPick(def)}
        {/each}
      </div>
    {/if}
    {#if current.knobs.length}
      <div class="sysknobs">
        {#each current.knobs as def (def.key)}
          {@render sysKnob(def)}
        {/each}
      </div>
    {/if}
  {/if}
{/snippet}

<div class="ctl">
  {#if section && layout}
    {@render systemPage(section, layout)}
  {:else if input}
    {@const i = input}
    {@const f = fieldOf(i)}
    <div class="head">
      <button class="back" onclick={() => (input = null)} aria-label={t(lang, 'ctl.back')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <h2>{i.label}</h2>
    </div>
    {@render pick(P(`assign.${i.key}.function`), t(lang, 'ctl.function'))}
    {#if f}
      {@render pick(P(`assign.${i.key}.${f.key}.target`), t(lang, 'ctl.target'), f.label)}
      <div class="knobs">
        {@render limit(P(`assign.${i.key}.${f.key}.min`))}
        {@render limit(P(`assign.${i.key}.${f.key}.max`))}
      </div>
      <p class="note">{t(lang, 'ctl.minMaxNote')}</p>
    {:else}
      <p class="note">{t(lang, 'ctl.noTarget')}</p>
    {/if}
  {:else}
    <div class="areas" role="tablist" aria-label={t(lang, 'ctl.sections')}>
      {#each AREAS as [key, label] (key)}
        <button role="tab" aria-selected={area === key} class:sel={area === key} onclick={() => (area = key)}>
          {t(lang, label)}
        </button>
      {/each}
    </div>

    {#if area === 'knobs'}
      <p class="lead">{t(lang, 'ctl.knobsNote')}</p>
      {#each knobRows as k (k.key)}
        {#if k.field}
          {@render pick(P(`assign.knobs.${k.field.key}.target`), k.label, k.typeName)}
        {/if}
      {/each}
    {:else if area === 'pedals'}
      {#each EXP_INPUTS as i (i.key)}
        {@const sm = summary(i)}
        {@const changed = PATCH_PARAMS.some(
          (p) => p.key.startsWith(`assign.${i.key}.`) && paramView(s, p).changed,
        )}
        <button
          class="row"
          class:changed
          use:longPress={() => openHelp({ key: `ctl.input.${i.key}`, title: i.label })}
          onclick={() => (input = i)}
        >
          <span class="rlabel">{i.label}</span>
          <span class="rsub">{sm.text}</span>
          {#if sm.range}<span class="rrange">{sm.range}</span>{/if}
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
        </button>
      {/each}
    {:else if area === 'system'}
      <p class="warn">{t(lang, 'ctl.systemNote')}</p>
      {#each SYSTEM_SECTIONS as sec (sec)}
        <button
          class="row"
          use:longPress={() =>
            openHelp({
              key: `system.section.${sec}`,
              title: SECTION_LABEL[sec],
              context: t(lang, 'ctl.system'),
            })}
          onclick={() => (section = sec)}
        >
          <span class="rlabel">{SECTION_LABEL[sec]}</span>
          <span class="rsub">{sectionSummary(sec)}</span>
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
        </button>
      {/each}
    {:else}
      <p class="lead">{t(lang, 'ctl.gafcSystem')}</p>
      <div class="grid">
        {#each GAFC_SYSTEM_PARAMS as def (def.key)}
          {@render sysPick(def)}
        {/each}
      </div>
      <p class="lead">{t(lang, 'ctl.gafcFs')}</p>
      <div class="grid">
        {#each GAFC_FS_PARAMS as def (def.key)}
          {@render pick(def, `GA-FC ${def.label}`)}
        {/each}
      </div>
      <p class="note">{t(lang, 'ctl.gafcFsNote')}</p>
      <p class="lead">{t(lang, 'ctl.ampFs')}</p>
      <div class="grid">
        {#each FS_PARAMS as def (def.key)}
          {@render pick(def, def.label)}
        {/each}
      </div>
    {/if}
  {/if}
</div>

{#if choosing}
  {@const c = choosing}
  {@const current = c.system ? sysRaw(c.def) : paramView(s, c.def).value}
  <Sheet title={c.title} closeLabel={t(lang, 'sheet.close')} onClose={() => (choosing = null)}>
    <div class="list">
      {#each c.def.display?.table ?? [] as name, i (i)}
        <button
          class:sel={current === i}
          aria-pressed={current === i}
          onclick={() => {
            if (c.system) setSys(c.def, i);
            else set(c.def, i);
            choosing = null;
          }}>{name}</button
        >
      {/each}
    </div>
  </Sheet>
{/if}

<style>
  .ctl {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
  }
  .areas {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 4px;
  }
  .areas button {
    min-height: 40px;
    min-width: 0;
    padding: 4px 2px;
    font-size: 14px;
    border-radius: 10px;
    background: var(--panel-2);
  }
  .areas button.sel {
    background: var(--accent);
    color: var(--on-accent);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .head h2 {
    margin: 0;
    font-size: 18px;
  }
  /* Back as on the effect pages: no button look, an accent arrow. */
  .back {
    min-height: 44px;
    min-width: 44px;
    padding: 0;
    margin-left: -8px;
    display: grid;
    place-items: center;
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
  .chev {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .lead {
    margin: 2px 2px 0;
    color: var(--faint);
    font-size: 13px;
  }
  .note {
    margin: 0 2px;
    color: var(--muted);
    font-size: 13px;
  }
  .pick,
  .row {
    display: grid;
    align-items: center;
    gap: 0 8px;
    width: 100%;
    box-sizing: border-box;
    text-align: left;
    background: var(--panel);
  }
  .pick {
    grid-template-columns: 1fr auto 18px;
    min-height: 48px;
    padding: 6px 12px;
  }
  .plabel {
    color: var(--muted);
    font-size: 14px;
  }
  .psub {
    color: var(--faint);
  }
  .pname {
    font-weight: 600;
  }
  .pick.changed .pname,
  .row.changed .rlabel {
    color: var(--warn);
  }
  .row {
    grid-template-columns: 1fr 18px;
    min-height: 52px;
    padding: 6px 12px;
  }
  .row .chev {
    grid-column: 2;
    grid-row: 1 / span 3;
  }
  .rlabel {
    font-weight: 600;
  }
  .rsub {
    color: var(--muted);
    font-size: 14px;
  }
  .rrange {
    color: var(--accent);
    font-size: 13px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .grid .pick {
    grid-template-columns: 1fr 18px;
    min-height: 46px;
  }
  .grid .plabel {
    font-size: 12px;
  }
  .grid .pname {
    grid-column: 1;
    font-size: 13px;
  }
  .grid .chev {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
  .knobs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    width: 100%;
    max-width: 300px;
    margin: 4px auto 0;
  }
  .warn {
    margin: 0 2px;
    color: var(--warn);
    font-size: 13px;
  }
  .seg,
  .pages {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .seg button,
  .pages button {
    min-height: 40px;
    min-width: 0;
    padding: 4px 2px;
    border-radius: 10px;
    background: var(--panel-2);
    font-size: 14px;
  }
  .seg button.sel,
  .pages button.sel {
    background: var(--accent);
    color: var(--on-accent);
  }
  .pick.toggle {
    grid-template-columns: 1fr auto;
  }
  .pick.toggle.on .pname {
    color: var(--ok);
  }
  .sysknobs {
    /* Knobs follow the height of the screen (main is a size container), 70–100 px. */
    --knob-max: clamp(70px, 14cqh, 100px);
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 60vh;
    overflow-y: auto;
  }
  .list button.sel {
    background: var(--accent);
    color: var(--on-accent);
  }
</style>
