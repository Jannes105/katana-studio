<script lang="ts">
  // Chain tab (Phase 2, draft A "vertical", decided 2026-11-17): the signal path from input (top) to speaker
  // (bottom) as one line through all blocks. Drag a block up or down: the chain shows live where it would land,
  // only on places the amp allows (placeBlock), and takes it on release. Tap a block: a bar with on/off, ▲▼ (one
  // step, for one hand) and the way to its page. Fits the height of <main> (container units).
  import type { Snippet } from 'svelte';
  import { flip } from 'svelte/animate';
  import {
    chainOrder,
    moveBlock,
    movable,
    placeBlock,
    type ChainBlock,
    type ChainSettings,
  } from '../model/chain';
  import { t, type Language } from './i18n';

  export interface BlockInfo {
    readonly label: string;
    readonly sub: string;
    /** On/off, undefined for blocks without a switch (amp) or while not read. */
    readonly on: boolean | undefined;
    readonly hasSwitch: boolean;
    readonly colour: string;
    readonly changed: boolean;
    /** The block's page can be opened. */
    readonly hasPage: boolean;
  }

  let {
    settings,
    info,
    lang,
    enabled,
    chainChanged,
    onapply,
    onopen,
    ontoggle,
    children,
  }: {
    settings: ChainSettings;
    info: (b: ChainBlock) => BlockInfo;
    lang: Language;
    /** Writing allowed (connected, chain parameters writable). */
    enabled: boolean;
    /** The chain differs from the stored slot. */
    chainChanged: boolean;
    onapply: (next: ChainSettings) => void;
    onopen: (b: ChainBlock) => void;
    ontoggle: (b: ChainBlock) => void;
    /** Rows below the chain (solo). */
    children?: Snippet;
  } = $props();

  let selected = $state<ChainBlock | null>(null);
  /** While dragging: the block, the pointer, the centres of the other blocks at the start, the preview. */
  let drag = $state<{
    block: ChainBlock;
    id: number;
    y0: number;
    moved: boolean;
    centres: { b: ChainBlock; y: number }[];
    preview: ChainSettings;
  } | null>(null);

  const order = $derived(chainOrder(drag?.preview ?? settings));
  let listEl = $state<HTMLOListElement | null>(null);

  function down(e: PointerEvent, b: ChainBlock): void {
    if (!listEl) return;
    const centres = [...listEl.querySelectorAll<HTMLElement>('li[data-block]')]
      .map((li) => {
        const r = li.getBoundingClientRect();
        return { b: li.dataset['block'] as ChainBlock, y: r.top + r.height / 2 };
      })
      .filter((c) => c.b !== b);
    drag = { block: b, id: e.pointerId, y0: e.clientY, moved: false, centres, preview: settings };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.abs(e.clientY - drag.y0) < 8) return;
    if (!enabled || !movable(drag.block)) return;
    drag.moved = true;
    const target = drag.centres.filter((c) => c.y < e.clientY).length;
    drag.preview = placeBlock(settings, drag.block, target);
  }
  function up(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.moved) {
      if (d.preview !== settings) onapply(d.preview);
      selected = d.block;
    } else selected = selected === d.block ? null : d.block;
  }
  function cancel(): void {
    drag = null;
  }
  function step(b: ChainBlock, dir: -1 | 1): void {
    const next = moveBlock(settings, b, dir);
    if (next) onapply(next);
  }
</script>

<div class="chain">
  <div class="end">
    {t(lang, 'chain.input')}{#if chainChanged}<span class="mark"></span>{/if}
  </div>
  <ol class="path" bind:this={listEl} aria-label={t(lang, 'chain.order')}>
    {#each order as b (b)}
      {@const i = info(b)}
      <li
        animate:flip={{ duration: 220 }}
        data-block={b}
        class:amp={b === 'amp'}
        class:fv={b === 'footVolume'}
      >
        {#if b === 'footVolume'}
          <span class="fvlabel">FV</span>
        {:else}
          <button
            class="block"
            class:on={i.on}
            class:sel={selected === b}
            class:lifted={drag?.block === b && drag.moved}
            style:--c={i.colour}
            aria-pressed={selected === b}
            onpointerdown={(e) => down(e, b)}
            onpointermove={move}
            onpointerup={up}
            onpointercancel={cancel}
            onclick={(e) => {
              if (e.detail === 0) selected = selected === b ? null : b; // keyboard
            }}
          >
            {#if i.hasSwitch}<span class="led"></span>{:else}<span></span>{/if}
            <span class="name"
              >{i.label}{#if i.changed}<span class="mark"></span>{/if}</span
            >
            <span class="sub">{i.sub}</span>
            {#if movable(b)}<span class="grip" aria-hidden="true">⇅</span>{:else}<span></span>{/if}
          </button>
        {/if}
      </li>
    {/each}
  </ol>
  <div class="end">{t(lang, 'chain.speaker')}</div>
  {#if children}<div class="extra">{@render children()}</div>{/if}

  <div class="bar">
    {#if selected}
      {@const b = selected}
      {@const i = info(b)}
      <span class="bname" style:--c={i.colour}>{i.label}</span>
      {#if i.hasSwitch}
        <button class="sw" class:on={i.on} disabled={!enabled} onclick={() => ontoggle(b)}
          >{i.on ? t(lang, 'fx.on') : t(lang, 'fx.off')}</button
        >
      {/if}
      {#if movable(b)}
        <button
          class="mv"
          disabled={!enabled || moveBlock(settings, b, -1) === null}
          onclick={() => step(b, -1)}
          aria-label={t(lang, 'chain.earlier')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
        </button>
        <button
          class="mv"
          disabled={!enabled || moveBlock(settings, b, 1) === null}
          onclick={() => step(b, 1)}
          aria-label={t(lang, 'chain.later')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      {/if}
      {#if i.hasPage}
        <button class="openp" onclick={() => onopen(b)}>{t(lang, 'chain.open')} ›</button>
      {/if}
    {:else}
      <span class="hint">{t(lang, 'chain.hint')}</span>
    {/if}
  </div>
</div>

<style>
  /*
   * Fits the height of <main>: the 11 blocks share what is left after input/speaker labels, FV mark, gaps,
   * the solo row and the bar (about 246 px); a block between 30 and 46 px.
   */
  .chain {
    --row: clamp(30px, calc((100cqh - 246px) / 11), 46px);
    position: relative;
    display: flex;
    flex-direction: column;
    /* the page around it pads 14 px left/right and 12 px at the bottom */
    min-height: calc(100cqh - 16px);
    box-sizing: border-box;
    padding: 4px 0 0;
    touch-action: none;
  }
  .end {
    align-self: center;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--faint);
    padding: 2px 0;
  }
  .path {
    position: relative;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* the signal line */
  .path::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--track);
  }
  li {
    position: relative;
    display: flex;
    justify-content: center;
    padding: 2px 0;
  }
  li.fv {
    padding: 0;
  }
  .block {
    position: relative;
    width: 76%;
    min-height: var(--row);
    display: grid;
    grid-template-columns: 10px auto 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 10px;
    text-align: left;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
    transition:
      transform 0.15s,
      box-shadow 0.15s;
  }
  .block.on {
    border-color: color-mix(in srgb, var(--c) 55%, transparent);
  }
  .block.sel {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .block.lifted {
    transform: scale(1.04);
    box-shadow: 0 6px 18px rgb(0 0 0 / 55%);
    z-index: 2;
  }
  .led {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--led-off);
  }
  .on .led {
    background: var(--c);
    box-shadow: 0 0 6px var(--c);
  }
  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 0.92rem;
  }
  .sub {
    font-size: 0.7rem;
    color: var(--faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grip {
    color: var(--faint);
    font-size: 0.85rem;
  }
  .amp .block {
    width: 92%;
    background: color-mix(in srgb, var(--accent) 12%, var(--panel-2));
    border-color: var(--accent);
  }
  .amp .name {
    color: var(--accent);
    letter-spacing: 0.1em;
  }
  .fvlabel {
    position: relative;
    font-size: 0.6rem;
    color: var(--faint);
    background: var(--bg);
    padding: 0 6px;
  }
  .mark {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--warn);
  }
  .extra {
    margin-top: 6px;
  }
  .bar {
    position: sticky;
    bottom: 0;
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 56px;
    padding: 6px 0 8px;
    background: var(--bg);
  }
  .bname {
    flex: 1;
    min-width: 0;
    font-weight: 700;
    color: var(--c);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar button {
    min-height: 44px;
    padding: 0 12px;
    font-size: 0.85rem;
  }
  .sw.on {
    color: var(--accent);
    border-color: var(--accent);
  }
  .mv {
    min-width: 48px;
    padding: 0;
  }
  .mv svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }
  .hint {
    flex: 1;
    color: var(--faint);
    font-size: 0.75rem;
    text-align: center;
  }
  /* Short screens: blocks closer together and a little lower. */
  @container (max-height: 600px) {
    .chain {
      --row: clamp(27px, calc((100cqh - 150px) / 12), 46px);
    }
    li {
      padding: 1px 0;
    }
    .end {
      padding: 0;
    }
    .bar {
      min-height: 50px;
      padding: 4px 0 6px;
    }
  }
</style>
