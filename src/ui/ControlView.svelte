<script lang="ts">
  // Control tab (Phase 3, direction B "own tab", decided 2026-11-17): what the effect knobs on the amp, the
  // expression inputs and the footswitches do in this patch. Three areas: amp knobs (target per effect, for mod
  // and FX the field of the active type), pedals (EXP pedal on the amp, GA-FC EXP 1–3: function, target and
  // the range from heel to toe) and switches (GA-FC FS1–3, footswitch on the amp). Nothing scrolls.
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
  import { effectiveRange, type ParamDef, type RangeSpec } from '../model/schema';
  import type { AmpConnection, ConnectionState, WriteResult } from '../state/connection';
  import Knob from './Knob.svelte';
  import Sheet from './Sheet.svelte';
  import { t, type Language } from './i18n';
  import { editable, effectRows, paramView } from './view';

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

  type Area = 'knobs' | 'pedals' | 'switches';
  let area = $state<Area>('knobs');
  let input = $state<ExpInput | null>(null);
  let choosing = $state<{ def: ParamDef; title: string } | null>(null);

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
      const text = r.display?.decimals === undefined ? String(n) : n.toFixed(r.display.decimals);
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
  const AREAS: readonly [Area, 'ctl.knobs' | 'ctl.pedals' | 'ctl.switches'][] = [
    ['knobs', 'ctl.knobs'],
    ['pedals', 'ctl.pedals'],
    ['switches', 'ctl.switches'],
  ];
</script>

{#snippet pick(def: ParamDef, label: string, sub: string = '')}
  {@const v = paramView(s, def)}
  <button
    class="pick"
    class:changed={v.changed}
    aria-haspopup="dialog"
    disabled={!editable(s, def)}
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
  />
{/snippet}

<div class="ctl">
  {#if input}
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
        <button class="row" class:changed onclick={() => (input = i)}>
          <span class="rlabel">{i.label}</span>
          <span class="rsub">{sm.text}</span>
          {#if sm.range}<span class="rrange">{sm.range}</span>{/if}
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
        </button>
      {/each}
    {:else}
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
  {@const current = paramView(s, c.def).value}
  <Sheet title={c.title} closeLabel={t(lang, 'sheet.close')} onClose={() => (choosing = null)}>
    <div class="list">
      {#each c.def.display?.table ?? [] as name, i (i)}
        <button
          class:sel={current === i}
          aria-pressed={current === i}
          onclick={() => {
            set(c.def, i);
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
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }
  .areas button {
    min-height: 40px;
    padding: 4px 8px;
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
  .back {
    min-height: 40px;
    min-width: 44px;
    padding: 0;
    display: grid;
    place-items: center;
  }
  .back svg,
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
    margin: 4px 2px 0;
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
    min-height: 54px;
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
