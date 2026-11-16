<script lang="ts">
  import { onMount } from 'svelte';
  import { APP_NAME, APP_SUBTITLE, APP_VERSION, DISCLAIMER } from '../app-info';
  import { pickLanguage, t } from './i18n';
  import { createApp } from './setup';
  import AmpView from './AmpView.svelte';
  import LogView from './LogView.svelte';

  const lang = pickLanguage(navigator.languages);
  const app = createApp();
  const connection = app.connection;
  let tab = $state<'amp' | 'log'>('amp');

  onMount(() => {
    void connection.start();
  });
</script>

<main>
  <header>
    <div>
      <h1>{APP_NAME}</h1>
      <p class="subtitle">{APP_SUBTITLE}</p>
    </div>
    <nav>
      <button class:active={tab === 'amp'} onclick={() => (tab = 'amp')}>{t(lang, 'tab.amp')}</button>
      <button class:active={tab === 'log'} onclick={() => (tab = 'log')}>{t(lang, 'tab.log')}</button>
    </nav>
  </header>

  {#if app.mock}
    <p class="mock">
      {t(lang, 'mock.notice')}
      <button onclick={() => app.mock?.unplug()}>{t(lang, 'mock.unplug')}</button>
      <button onclick={() => app.mock?.plug()}>{t(lang, 'mock.plug')}</button>
    </p>
  {/if}

  {#if tab === 'amp'}
    <AmpView {connection} {lang} />
  {:else}
    <LogView {app} {lang} />
  {/if}

  <footer>
    <p>v{APP_VERSION}</p>
    <p class="disclaimer">{DISCLAIMER}</p>
  </footer>
</main>

<style>
  :global(:root) {
    --bg: #111317;
    --panel: #1c1f25;
    --fg: #e8eaed;
    --muted: #9aa0a6;
    --accent: #f29900;
    --ok: #34a853;
    --warn: #fbbc04;
    --error: #ea4335;
    color-scheme: dark;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: system-ui, sans-serif;
  }
  :global(button) {
    font: inherit;
    color: var(--fg);
    background: var(--panel);
    border: 1px solid #3c4043;
    border-radius: 10px;
    padding: 10px 14px;
    min-height: 48px;
  }
  :global(button:disabled) {
    opacity: 0.4;
  }
  main {
    padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
    max-width: 640px;
    margin: 0 auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  .subtitle {
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
  nav {
    display: flex;
    gap: 6px;
  }
  nav button.active {
    border-color: var(--accent);
    color: var(--accent);
  }
  .mock {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 12px 0 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: #2a2416;
    color: var(--warn);
    font-size: 0.9rem;
  }
  .mock button {
    min-height: 36px;
    padding: 4px 10px;
  }
  footer {
    margin-top: 32px;
    color: var(--muted);
    font-size: 0.8rem;
  }
</style>
