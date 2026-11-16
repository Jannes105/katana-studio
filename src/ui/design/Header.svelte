<script lang="ts">
  import type { Proto } from './proto.svelte';

  let {
    proto,
    big = false,
    onChannel,
    onStatus,
  }: { proto: Proto; big?: boolean; onChannel: () => void; onStatus: () => void } = $props();

  const s = $derived(proto.s);
  const dot = $derived(
    s.phase === 'connected'
      ? proto.readOnly
        ? 'warn'
        : 'ok'
      : s.phase === 'error'
        ? 'error'
        : s.phase === 'waiting'
          ? 'off'
          : 'busy',
  );
  const unsavedCount = $derived(proto.unsavedOffsets.length);
</script>

<header class:big>
  <button class="channel" onclick={onChannel} aria-label="Kanal wählen">
    <span class="slot">{proto.hasData ? proto.slot : '––'}</span>
    <span class="meta">
      <span class="name">{proto.hasData ? (s.patchName ?? '').trim() || '–' : 'Kein Patch'}</span>
      <span class="saved" class:unsaved={unsavedCount > 0}>
        {#if !proto.hasData}
          &nbsp;
        {:else if unsavedCount > 0}
          Ungespeichert · {unsavedCount}
        {:else}
          Gespeichert
        {/if}
      </span>
    </span>
    <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
  </button>
  <button class="conn" onclick={onStatus} aria-label="Verbindung">
    <span class="dot {dot}"></span>
    <span class="usb">{s.reading ? 'Liest' : 'USB'}</span>
  </button>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 8px 14px;
  }
  .channel {
    all: unset;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    min-height: 56px;
    cursor: pointer;
  }
  .slot {
    display: grid;
    place-items: center;
    min-width: 64px;
    height: 52px;
    padding: 0 8px;
    box-sizing: border-box;
    border-radius: 10px;
    background: var(--display);
    box-shadow: inset 0 1px 3px rgb(0 0 0 / 60%);
    color: var(--accent);
    font-size: 1.85rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    text-shadow: 0 0 10px color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }
  .name {
    font-size: 1.3rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .saved {
    color: var(--faint);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .saved.unsaved {
    color: var(--warn);
  }
  .chev {
    width: 20px;
    height: 20px;
    flex: none;
    fill: none;
    stroke: var(--faint);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .big .slot {
    min-width: 84px;
    height: 68px;
    font-size: 2.6rem;
  }
  .big .name {
    font-size: 1.7rem;
  }
  .conn {
    all: unset;
    display: flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    padding: 6px 4px 10px 10px;
    cursor: pointer;
    color: var(--faint);
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--led-off);
  }
  .dot.ok {
    background: var(--ok);
    box-shadow: 0 0 6px var(--ok);
  }
  .dot.warn {
    background: var(--warn);
  }
  .dot.error {
    background: var(--error);
    box-shadow: 0 0 6px var(--error);
  }
  .dot.busy {
    background: var(--muted);
    animation: pulse 0.9s ease-in-out infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: 0.2;
    }
  }
</style>
