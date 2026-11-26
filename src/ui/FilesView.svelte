<script lang="ts">
  // Files tab (decided 2026-11-26, draft A "list"; it took the place of the log tab): backup, patch files and
  // .tsl, then the settings (language, log, info). Before, all of this sat in the connection window behind
  // "● USB", which now only shows the connection. The actions themselves live in App (the save confirmation
  // and the load window use them too); this view lays them out.
  import { APP_NAME, APP_SUBTITLE, APP_VERSION, DISCLAIMER } from '../app-info';
  import type { ConnectionState } from '../state/connection';
  import LogView from './LogView.svelte';
  import { onBack } from './back';
  import { LANGUAGES, LANGUAGE_NAMES, t, type Language } from './i18n';
  import type { App } from './setup';
  import { canEdit, hasPatch } from './view';

  let {
    s,
    lang,
    app,
    logOpen = $bindable(false),
    fileNote,
    lastBackup,
    onBackup,
    onSavePatch,
    onTslPatch,
    onTslChannels,
    onLoad,
    onLanguage,
  }: {
    s: ConnectionState;
    lang: Language;
    app: App;
    /** The log page is open (also opened from the connection window). */
    logOpen?: boolean;
    /** Result of the last backup or export. */
    fileNote: { ok: boolean; text: string } | null;
    /** Local date (YYYY-MM-DD) of the last complete backup on this phone, null if none. */
    lastBackup: string | null;
    onBackup: () => void;
    onSavePatch: () => void;
    onTslPatch: () => void;
    onTslChannels: () => void;
    onLoad: () => void;
    onLanguage: (l: Language) => void;
  } = $props();

  $effect(() => {
    if (logOpen) return onBack(() => (logOpen = false));
  });

  const shown = $derived(hasPatch(s));
  /** Reading the whole amp (backup, A1–B4 as .tsl) needs a connection and nothing else reading. */
  const canRead = $derived(s.phase === 'connected' && !s.reading && !s.backingUp);
  const lastText = $derived.by(() => {
    if (lastBackup === null) return t(lang, 'files.noBackup');
    const day =
      lastBackup === new Date().toLocaleDateString('sv')
        ? t(lang, 'files.today')
        : new Date(`${lastBackup}T00:00`).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB');
    return t(lang, 'files.lastBackup', { date: day });
  });
</script>

{#snippet chevron()}
  <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
{/snippet}

<div class="files">
  {#if logOpen}
    <div class="head">
      <button class="back" onclick={() => (logOpen = false)} aria-label={t(lang, 'files.back')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <h2>{t(lang, 'files.log')}</h2>
    </div>
    <LogView {app} {lang} />
  {:else}
    <div class="sect"><span class="title">{t(lang, 'backup.title')}</span><i></i></div>
    <div class="card">
      <p class="last" class:none={lastBackup === null}>{lastText}</p>
      <button class="primary" disabled={!canRead} onclick={onBackup}>
        {s.backingUp ? t(lang, 'backup.running') : t(lang, 'backup.all')}
      </button>
      <p class="hint">{t(lang, 'backup.hint')}</p>
    </div>

    <div class="sect"><span class="title">{t(lang, 'files.patch')}</span><i></i></div>
    <ul class="list">
      <li><button disabled={!shown} onclick={onSavePatch}>{t(lang, 'backup.patch')}</button></li>
      <li><button disabled={!shown} onclick={onTslPatch}>{t(lang, 'tsl.patch')}</button></li>
      <li>
        <button disabled={!canEdit(s)} onclick={onLoad}>
          <span class="text">
            {t(lang, 'load.button')}
            <span class="sub">{t(lang, 'load.hint')}</span>
          </span>
        </button>
      </li>
    </ul>

    <div class="sect"><span class="title">{t(lang, 'files.channels')}</span><i></i></div>
    <ul class="list">
      <li>
        <button disabled={!canRead} onclick={onTslChannels}>
          <span class="text">
            {s.backingUp ? t(lang, 'backup.running') : t(lang, 'tsl.channels')}
            <span class="sub">{t(lang, 'tsl.hint')}</span>
          </span>
        </button>
      </li>
    </ul>

    {#if fileNote}
      <p class="note" class:error={!fileNote.ok} role="status">{fileNote.text}</p>
    {/if}

    <div class="sect"><span class="title">{t(lang, 'files.settings')}</span><i></i></div>
    <ul class="list">
      <li class="lang">
        <span>{t(lang, 'fact.language')}</span>
        <span class="seg" role="radiogroup" aria-label={t(lang, 'fact.language')}>
          {#each LANGUAGES as l (l)}
            <button
              role="radio"
              aria-checked={lang === l}
              class:sel={lang === l}
              onclick={() => onLanguage(l)}>{LANGUAGE_NAMES[l]}</button
            >
          {/each}
        </span>
      </li>
      <li>
        <button onclick={() => (logOpen = true)}>
          <span class="text">
            {t(lang, 'files.log')}
            <span class="sub">{t(lang, 'files.logHint')}</span>
          </span>
          {@render chevron()}
        </button>
      </li>
    </ul>

    <p class="info">{APP_NAME} v{APP_VERSION}<br />{APP_SUBTITLE} · {DISCLAIMER}</p>
  {/if}
</div>

<style>
  .files {
    padding: 0 14px 16px;
  }
  .card {
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--panel-2);
  }
  .card button {
    width: 100%;
  }
  .last {
    margin: 0 0 10px;
    font-weight: 600;
  }
  .last.none {
    color: var(--warn);
  }
  .hint {
    margin: 8px 0 0;
    color: var(--faint);
    font-size: 0.75rem;
    line-height: 1.4;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-radius: 14px;
    background: var(--panel-2);
    overflow: hidden;
  }
  .list > li + li {
    border-top: 1px solid var(--line);
  }
  .list button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 8px 14px 8px 16px;
    text-align: left;
    background: none;
    border-radius: 0;
  }
  .text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sub {
    color: var(--faint);
    font-size: 0.75rem;
    line-height: 1.35;
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
  .lang {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 52px;
    padding: 0 8px 0 16px;
  }
  .seg {
    display: flex;
    gap: 6px;
  }
  .seg button {
    min-height: 40px;
    padding: 0 12px;
    font-size: 0.85rem;
    color: var(--muted);
    background: var(--panel);
    border-radius: 10px;
  }
  .seg button.sel {
    border-color: var(--accent);
    color: var(--accent);
  }
  .note {
    margin: 10px 4px 0;
    color: var(--ok);
    font-size: 0.85rem;
  }
  .note.error {
    color: var(--error);
  }
  .info {
    margin: 18px 4px 0;
    color: var(--faint);
    font-size: 0.75rem;
    line-height: 1.5;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 52px;
  }
  .head h2 {
    margin: 0;
    font-size: 1.45rem;
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
  .back svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
