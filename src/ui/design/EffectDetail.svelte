<script lang="ts">
  // Effect page (direction C): variation with its type, type choice and all knobs of the active variation.
  // Types and knobs are placeholders until the parameter list has them (PLAN 9.2 E 23); NS uses the real values.
  import { COLOUR_LIST } from './colours';
  import Knob from './Knob.svelte';
  import { EFFECTS, FX_DETAILS, PARAMS, type Proto } from './proto.svelte';

  let { proto, effect, onback }: { proto: Proto; effect: string; onback: () => void } = $props();

  const def = $derived(EFFECTS.find((e) => e.key === effect));
  const detail = $derived(FX_DETAILS[effect]);
  const on = $derived(def ? proto.value(def.switchOffset) === 1 : false);
  const colour = $derived(def?.colourOffset == null ? null : proto.value(def.colourOffset));
  const css = $derived(colour === null ? 'var(--accent)' : (COLOUR_LIST[colour]?.css ?? 'var(--accent)'));
  let choosingType = $state(false);
</script>

{#if def}
  <div class="page" style:--c={css}>
    <div class="top">
      <button class="back" onclick={onback} aria-label="Zurück zu Effekte">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <h2>{def.label}</h2>
      <button
        class="switch"
        class:on
        role="switch"
        aria-checked={on}
        aria-label="{def.label} an/aus"
        disabled={!proto.canWrite}
        onclick={() => proto.set(def.switchOffset, on ? 0 : 1, 1)}
      >
        <span class="state">{on ? 'An' : 'Aus'}</span>
        <span class="track"><span class="thumb"></span></span>
      </button>
    </div>

    {#if def.colourOffset !== null && detail && colour !== null}
      {@const off = def.colourOffset}
      <div class="sect"><span class="title">Variation</span><i></i></div>
      <div class="variations" role="radiogroup" aria-label="Variation">
        {#each COLOUR_LIST as c, i (c.name)}
          <button
            role="radio"
            aria-checked={colour === i}
            class:sel={colour === i}
            style:--v={c.css}
            disabled={!proto.canWrite}
            onclick={() => proto.set(off, i, 2)}
          >
            <span class="vhead"><span class="led"></span>{c.name}</span>
            <span class="vtype">{proto.fx.typeName(effect, i)}</span>
          </button>
        {/each}
      </div>
      <p class="note">
        Drei eigene Einstellungen, am Amp mit dem Taster umgeschaltet. Bearbeitet wird die aktive.
      </p>

      <button
        class="type"
        class:open={choosingType}
        disabled={!proto.canWrite}
        aria-expanded={choosingType}
        onclick={() => (choosingType = !choosingType)}
      >
        <span class="tlabel">Typ</span>
        <span class="tname">{proto.fx.typeName(effect, colour)}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
      </button>
      {#if choosingType}
        <ul class="types">
          {#each detail.types as t, i (t)}
            <li>
              <button
                class:sel={proto.fx.typeOf(effect, colour) === i}
                onclick={() => {
                  proto.fx.setType(effect, colour, i);
                  choosingType = false;
                }}><span class="led"></span>{t}</button
              >
            </li>
          {/each}
        </ul>
      {/if}

      <div class="sect">
        <span class="title">Regler</span>
        <span class="tag">Platzhalter</span>
        <i></i>
      </div>
      <div class="knobs" class:locked={!proto.canWrite}>
        {#each detail.knobs as k (k.key)}
          <Knob
            label={k.label}
            value={proto.fx.knob(effect, colour, k)}
            min={k.min}
            max={k.max}
            enabled={proto.canWrite}
            {...k.format ? { format: k.format } : {}}
            onchange={(v) => proto.fx.setKnob(effect, colour, k, v)}
          />
        {/each}
      </div>
      {#if detail.typeDependent}
        <p class="note">Die Regler hängen vom Typ ab; hier drei Beispiele. Mod und FX folgen in Phase 2.</p>
      {/if}
    {:else}
      <div class="sect"><span class="title">Regler</span><i></i></div>
      <div class="knobs" class:locked={!proto.canWrite}>
        {#each PARAMS.filter((p) => p.group === 'ns') as p (p.key)}
          <Knob
            label={p.label}
            value={proto.value(p.offset)}
            stored={proto.storedValue(p.offset)}
            enabled={proto.canWrite}
            onchange={(v) => proto.set(p.offset, v)}
            onreset={() => proto.resetParam(p.offset)}
          />
        {/each}
      </div>
      <p class="note">Keine Variationen. Dieselben Regler stehen auch im Probe-Tab.</p>
    {/if}
  </div>
{/if}

<style>
  .page {
    padding: 0 14px 12px;
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
  .back svg,
  .type svg {
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
  .switch {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 4px 0 10px;
    background: none;
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
    transition: left 0.15s;
  }
  .on .track {
    background: color-mix(in srgb, var(--c) 40%, transparent);
  }
  .on .thumb {
    left: 23px;
    background: var(--c);
  }
  .sect {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    margin-top: 6px;
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
  }
  .variations {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-radius: 12px;
    background: var(--panel-2);
    overflow: hidden;
  }
  .variations button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    min-height: 68px;
    padding: 10px 12px;
    border-radius: 0;
    background: none;
    text-align: left;
    box-shadow: inset 0 -2px 0 transparent;
  }
  .variations button + button {
    border-left: 1px solid var(--line);
  }
  .variations button.sel {
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
  .sel .led {
    background: var(--v);
    box-shadow: 0 0 6px 1px var(--v);
  }
  .vtype {
    font-size: 0.92rem;
    font-weight: 600;
    line-height: 1.2;
    color: var(--muted);
  }
  .sel .vtype {
    color: var(--fg);
  }
  .note {
    color: var(--faint);
    font-size: 0.78rem;
    line-height: 1.4;
    margin: 8px 2px 10px;
  }
  .type {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 54px;
    padding: 0 12px 0 16px;
    border-radius: 12px;
    background: var(--panel-2);
    text-align: left;
  }
  .type svg {
    transition: transform 0.15s;
  }
  .type.open svg {
    transform: rotate(180deg);
  }
  .tlabel {
    color: var(--faint);
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .tname {
    flex: 1;
    font-size: 1.1rem;
    font-weight: 600;
  }
  .types {
    list-style: none;
    margin: 6px 0 0;
    padding: 4px 0;
    border-radius: 12px;
    background: var(--panel-2);
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .types button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 46px;
    background: none;
    color: var(--muted);
    text-align: left;
  }
  .types button.sel {
    color: var(--fg);
  }
  .types button.sel .led {
    background: var(--accent);
    box-shadow: 0 0 6px 1px color-mix(in srgb, var(--accent) 70%, transparent);
  }
  .knobs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0 4px;
  }
  .locked {
    opacity: 0.45;
  }
</style>
