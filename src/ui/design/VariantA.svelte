<script lang="ts">
  // Direction A "Fader": every parameter as a wide bar, drag anywhere on it (relative, no jump), ± for single steps.
  import { relativeDrag } from './drag';
  import { GROUP_TITLES, PARAMS, type Proto } from './proto.svelte';

  let { proto }: { proto: Proto } = $props();
  const groups = (['amp', 'ns'] as const).map((g) => ({
    title: GROUP_TITLES[g],
    params: PARAMS.filter((p) => p.group === g),
  }));
  let active = $state<number | null>(null);
</script>

<div class="list" class:locked={!proto.canWrite}>
  {#each groups as g (g.title)}
    <p class="group">{g.title}</p>
    {#each g.params as p (p.key)}
      {@const v = proto.value(p.offset)}
      {@const st = proto.storedValue(p.offset)}
      <div class="row" class:changed={proto.changed(p.offset)} class:active={active === p.offset}>
        <button
          class="step"
          disabled={!proto.canWrite}
          onclick={() => proto.set(p.offset, v - 1)}
          aria-label="{p.label} minus 1">−</button
        >
        <div
          class="bar"
          role="slider"
          tabindex="0"
          aria-label={p.label}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={v}
          use:relativeDrag={{
            axis: 'x',
            pxPerStep: (n) => n.clientWidth / 100,
            get: () => proto.value(p.offset),
            set: (x) => proto.set(p.offset, x),
            enabled: () => proto.canWrite,
            onDoubleTap: () => proto.resetParam(p.offset),
            onDrag: (d) => (active = d ? p.offset : null),
          }}
        >
          <div class="fill" style:width="{v}%"></div>
          {#if proto.changed(p.offset)}
            <div class="mark" style:left="{st}%" title="gespeichert: {st}"></div>
          {/if}
          <span class="label">{p.label}</span>
          <span class="value">{v}</span>
        </div>
        <button
          class="step"
          disabled={!proto.canWrite}
          onclick={() => proto.set(p.offset, v + 1)}
          aria-label="{p.label} plus 1">+</button
        >
      </div>
    {/each}
  {/each}
  <p class="hint">
    Ziehen auf dem Balken ändert den Wert (kein Springen beim Antippen) · Doppeltipp = gespeicherter Wert ·
    Strich = gespeicherter Stand
  </p>
</div>

<style>
  .list {
    padding: 0 12px;
  }
  .locked {
    opacity: 0.5;
  }
  .group {
    margin: 4px 4px 4px;
    color: var(--muted);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .row {
    display: grid;
    grid-template-columns: 48px 1fr 48px;
    gap: 6px;
    margin-bottom: 6px;
  }
  .step {
    min-height: 50px;
    padding: 0;
    font-size: 1.6rem;
    border-radius: 12px;
  }
  .bar {
    position: relative;
    height: 50px;
    border-radius: 12px;
    background: var(--panel);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    cursor: ew-resize;
    user-select: none;
    border: 1px solid transparent;
  }
  .active .bar {
    border-color: var(--accent);
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--fill);
    pointer-events: none;
  }
  .changed .fill {
    background: var(--fill-changed);
  }
  .mark {
    position: absolute;
    top: 6px;
    bottom: 6px;
    width: 3px;
    margin-left: -1px;
    background: var(--fg);
    opacity: 0.7;
    border-radius: 2px;
    pointer-events: none;
  }
  .label,
  .value {
    position: relative;
    pointer-events: none;
  }
  .label {
    font-size: 1.1rem;
    font-weight: 600;
  }
  .value {
    font-size: 1.7rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .changed .value {
    color: var(--warn);
  }
  .hint {
    color: var(--muted);
    font-size: 0.78rem;
    margin: 8px 4px 0;
  }
</style>
