<script lang="ts">
  // Effects list: on/off, the active variation with its type, tap a row for the effect page.
  import { COLOUR_LIST } from './colours';
  import { EFFECTS, type Proto } from './proto.svelte';

  let { proto, onopen }: { proto: Proto; onopen: (key: string) => void } = $props();
</script>

<div class="page" class:locked={!proto.canWrite}>
  <div class="sect"><span class="title">Effekte</span><i></i></div>
  <ul class="list">
    {#each EFFECTS as e (e.key)}
      {@const on = proto.value(e.switchOffset) === 1}
      {@const colour = e.colourOffset === null ? null : proto.value(e.colourOffset)}
      {@const c = colour === null ? null : COLOUR_LIST[colour]}
      {@const changed =
        proto.changed(e.switchOffset) || (e.colourOffset !== null && proto.changed(e.colourOffset))}
      <li class:on class:changed style:--c={c?.css ?? 'var(--accent)'}>
        <button class="open" onclick={() => onopen(e.key)}>
          <span class="led"></span>
          <span class="text">
            <span class="name"
              >{e.label}{#if changed}<span class="mark" title="ungespeichert"></span>{/if}</span
            >
            <span class="sub">
              {#if c && colour !== null}
                <span class="swatch">{c.name}</span>{proto.fx.typeName(e.key, colour)}
              {:else}
                Threshold {proto.value(e.switchOffset + 1)} · Release {proto.value(e.switchOffset + 2)}
              {/if}
            </span>
          </span>
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
        </button>
        <button
          class="switch"
          role="switch"
          aria-checked={on}
          aria-label="{e.label} an/aus"
          disabled={!proto.canWrite}
          onclick={() => proto.set(e.switchOffset, on ? 0 : 1, 1)}
        >
          <span class="track"><span class="thumb"></span></span>
        </button>
      </li>
    {/each}
  </ul>
  <p class="note">
    Grün, Rot und Gelb sind die drei <strong>Variationen</strong> eines Effekts: drei eigene Einstellungen mit eigenem
    Typ, umgeschaltet mit dem Taster am Amp.
  </p>
</div>

<style>
  .page {
    padding: 0 14px 8px;
  }
  .locked {
    opacity: 0.45;
  }
  .sect {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
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
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-radius: 14px;
    background: var(--panel-2);
    overflow: hidden;
  }
  li {
    display: flex;
    align-items: stretch;
  }
  li + li {
    border-top: 1px solid var(--line);
  }
  .open {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 66px;
    padding: 0 6px 0 16px;
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
    display: grid;
    place-items: center;
    width: 76px;
    padding: 0;
    background: none;
    border-radius: 0;
  }
  .track {
    position: relative;
    width: 46px;
    height: 26px;
    border-radius: 13px;
    background: var(--track);
    transition: background 0.15s;
  }
  .thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--muted);
    transition:
      left 0.15s,
      background 0.15s;
  }
  .on .track {
    background: color-mix(in srgb, var(--c) 40%, transparent);
  }
  .on .thumb {
    left: 23px;
    background: var(--c);
  }
  .note {
    color: var(--faint);
    font-size: 0.8rem;
    line-height: 1.45;
    margin: 12px 4px 0;
  }
  .note strong {
    color: var(--muted);
  }
</style>
