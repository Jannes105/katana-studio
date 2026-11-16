<script lang="ts">
  // Channel as a dark display with glowing letters, patch name large, "unsaved" below it, connection dot small in
  // the corner (PLAN 5, design round: what must be visible at a glance).
  import { slotName, type ConnectionState } from '../state/connection';
  import { t, type Language } from './i18n';
  import { connectionDot, hasPatch } from './view';

  let {
    s,
    lang,
    onStatus,
    onChannels,
  }: { s: ConnectionState; lang: Language; onStatus: () => void; onChannels: () => void } = $props();

  const shown = $derived(hasPatch(s));
  const dot = $derived(connectionDot(s));
  const unsaved = $derived(s.unsavedKnown && s.unsaved.length > 0);
</script>

<header>
  <div class="channel">
    <button class="slot" onclick={onChannels} aria-label={t(lang, 'header.channels')} aria-haspopup="dialog">
      {shown ? slotName(s.patchIndex) : '––'}
    </button>
    <span class="meta">
      <span class="name">{shown ? s.patchName || '–' : t(lang, 'header.noPatch')}</span>
      <span class="saved" class:unsaved>
        {#if !shown || !s.unsavedKnown}
          &nbsp;
        {:else if unsaved}
          {t(lang, 'header.unsaved')}
        {:else}
          {t(lang, 'header.saved')}
        {/if}
      </span>
    </span>
  </div>
  <button class="conn" onclick={onStatus} aria-label={t(lang, 'header.status')}>
    <span class="dot {dot}"></span>
    <span class="usb">{s.reading ? t(lang, 'status.reading') : t(lang, 'status.usb')}</span>
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
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    min-height: 56px;
  }
  .slot {
    display: grid;
    place-items: center;
    min-width: 64px;
    height: 52px;
    padding: 0 8px;
    box-sizing: border-box;
    border-radius: 10px;
    border: none;
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
  .conn {
    all: unset;
    display: flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    min-height: 40px;
    padding: 0 4px 0 12px;
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
