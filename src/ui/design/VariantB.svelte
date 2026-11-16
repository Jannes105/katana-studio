<script lang="ts">
  // Direction B "Kacheln": large numbers readable from a distance; tap a tile to adjust it in a sheet at the bottom
  // (thumb zone) with a big swipe pad and ±1/±5. Nothing changes by touching a tile itself.
  import { relativeDrag } from './drag';
  import { PARAMS, type Proto } from './proto.svelte';

  let { proto }: { proto: Proto } = $props();
  let focus = $state<number | null>(null);
  const current = $derived(PARAMS[focus ?? -1]);

  function move(delta: number): void {
    if (focus === null) return;
    focus = (focus + delta + PARAMS.length) % PARAMS.length;
  }
</script>

<div class="grid" class:locked={!proto.canWrite}>
  {#each PARAMS as p, i (p.key)}
    {@const v = proto.value(p.offset)}
    <button
      class="tile"
      class:changed={proto.changed(p.offset)}
      class:ns={p.group === 'ns'}
      onclick={() => (focus = i)}
    >
      <span class="label">{p.group === 'ns' ? `NS ${p.label}` : p.label}</span>
      <span class="value">{v}</span>
      <span class="bar"><span style:width="{v}%"></span></span>
    </button>
  {/each}
</div>
<p class="hint">Kachel antippen zum Einstellen · Orange = weicht vom gespeicherten Stand ab</p>

{#if current && focus !== null}
  {@const p = current}
  {@const v = proto.value(p.offset)}
  {@const st = proto.storedValue(p.offset)}
  <div class="backdrop" role="presentation" onclick={() => (focus = null)}></div>
  <div class="sheet" role="dialog" aria-label={p.label}>
    <div class="nav">
      <button onclick={() => move(-1)} aria-label="vorheriger Regler">‹</button>
      <span class="title">{p.group === 'ns' ? `NS ${p.label}` : p.label}</span>
      <button onclick={() => move(1)} aria-label="nächster Regler">›</button>
    </div>
    <div
      class="pad"
      class:changed={proto.changed(p.offset)}
      role="slider"
      tabindex="0"
      aria-label={p.label}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={v}
      use:relativeDrag={{
        axis: 'y',
        pxPerStep: 5,
        get: () => proto.value(p.offset),
        set: (x) => proto.set(p.offset, x),
        enabled: () => proto.canWrite,
        onDoubleTap: () => proto.resetParam(p.offset),
      }}
    >
      <span class="big">{v}</span>
      <span class="padhint">↕ hoch/runter wischen</span>
    </div>
    <div class="steps">
      <button disabled={!proto.canWrite} onclick={() => proto.set(p.offset, v - 5)}>−5</button>
      <button disabled={!proto.canWrite} onclick={() => proto.set(p.offset, v - 1)}>−1</button>
      <button disabled={!proto.canWrite} onclick={() => proto.set(p.offset, v + 1)}>+1</button>
      <button disabled={!proto.canWrite} onclick={() => proto.set(p.offset, v + 5)}>+5</button>
    </div>
    <div class="foot">
      <button
        class="reset"
        disabled={!proto.canWrite || !proto.changed(p.offset)}
        onclick={() => proto.resetParam(p.offset)}>Zurück auf {st}</button
      >
      <button class="done" onclick={() => (focus = null)}>Fertig</button>
    </div>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 4px 12px 0;
  }
  .locked {
    opacity: 0.5;
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 12px 14px 12px;
    min-height: 112px;
    border-radius: 16px;
    text-align: left;
    border: 2px solid transparent;
  }
  .tile.ns {
    background: var(--panel-2);
  }
  .tile.changed {
    border-color: var(--warn);
  }
  .label {
    color: var(--muted);
    font-size: 1rem;
    font-weight: 600;
  }
  .value {
    font-size: 3rem;
    font-weight: 800;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .changed .value {
    color: var(--warn);
  }
  .bar {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: var(--track);
    overflow: hidden;
    margin-top: 6px;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .hint {
    color: var(--muted);
    font-size: 0.78rem;
    margin: 10px 16px 0;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 55%);
    z-index: 20;
  }
  .sheet {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: 0;
    width: min(100%, 480px);
    box-sizing: border-box;
    z-index: 21;
    background: var(--sheet);
    border-radius: 22px 22px 0 0;
    padding: 12px 16px max(16px, env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .nav {
    display: grid;
    grid-template-columns: 64px 1fr 64px;
    align-items: center;
  }
  .nav button {
    font-size: 1.8rem;
    padding: 0;
  }
  .title {
    text-align: center;
    font-size: 1.4rem;
    font-weight: 700;
  }
  .pad {
    height: 200px;
    border-radius: 18px;
    background: var(--panel);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: ns-resize;
    user-select: none;
  }
  .big {
    font-size: 6.5rem;
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .pad.changed .big {
    color: var(--warn);
  }
  .padhint {
    color: var(--muted);
    font-size: 0.85rem;
    margin-top: 8px;
  }
  .steps {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .steps button {
    min-height: 64px;
    font-size: 1.3rem;
    font-weight: 700;
  }
  .foot {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .done {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
