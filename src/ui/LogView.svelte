<script lang="ts">
  import { APP_VERSION } from '../app-info';
  import type { LogEntry } from '../state/connection';
  import { fromStore } from 'svelte/store';
  import { t, type Language } from './i18n';
  import type { App } from './setup';

  let { app, lang }: { app: App; lang: Language } = $props();

  // svelte-ignore state_referenced_locally
  const log = fromStore(app.connection.log);
  const entries = $derived(log.current);
  let feedback = $state('');
  let list: HTMLElement | undefined = $state();

  const fmt = (time: number) => new Date(time).toISOString().slice(11, 23);
  const asText = (all: readonly LogEntry[]) =>
    [`Katana Studio ${APP_VERSION}`, ...all.map((e) => `${fmt(e.time)} ${e.level.padEnd(5)} ${e.text}`)].join(
      '\n',
    );

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      feedback = t(lang, 'log.copied');
    } catch {
      feedback = t(lang, 'log.copyFailed');
    }
    setTimeout(() => (feedback = ''), 2000);
  }

  // Keep the newest entry in view.
  $effect(() => {
    void entries.length;
    list?.scrollTo({ top: list.scrollHeight });
  });
</script>

<section>
  <div class="actions">
    <button onclick={() => void copy(asText(entries))}>{t(lang, 'log.copy')}</button>
    <button onclick={() => void copy(app.captureJson())}>{t(lang, 'log.copyCapture')}</button>
    <button onclick={() => app.connection.clearLog()}>{t(lang, 'log.clear')}</button>
  </div>
  {#if feedback}
    <p class="feedback">{feedback}</p>
  {/if}
  <p class="hint">{t(lang, 'log.verbose')}</p>
  <div class="list" bind:this={list}>
    {#each entries as e, i (i)}
      <p class={e.level}><span class="time">{fmt(e.time)}</span> {e.text}</p>
    {:else}
      <p class="empty">{t(lang, 'log.empty')}</p>
    {/each}
  </div>
</section>

<style>
  section {
    margin-top: 16px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .feedback {
    color: var(--ok);
    margin: 8px 0 0;
  }
  .hint {
    color: var(--muted);
    font-size: 0.8rem;
    margin: 8px 0;
  }
  .list {
    max-height: 60vh;
    overflow-y: auto;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--panel);
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    line-height: 1.4;
  }
  .list p {
    margin: 0 0 4px;
    word-break: break-word;
  }
  .time {
    color: var(--muted);
  }
  .warn {
    color: var(--warn);
  }
  .error {
    color: var(--error);
  }
  .empty {
    color: var(--muted);
  }
</style>
