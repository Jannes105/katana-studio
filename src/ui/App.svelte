<script lang="ts">
  // App shell, direction C (PLAN 5, design round): header with channel display, banners for the connection
  // states, the tabs Rehearsal / Effects / Log, and the connection window behind the dot in the header.
  import { onMount } from 'svelte';
  import { fromStore } from 'svelte/store';
  import { APP_NAME, APP_SUBTITLE, APP_VERSION, DISCLAIMER } from '../app-info';
  import { ADDR, PATCH_SLOT_NAMES } from '../protocol/address';
  import { AMP_KNOBS } from '../model/params';
  import Header from './Header.svelte';
  import LogView from './LogView.svelte';
  import EffectsView from './EffectsView.svelte';
  import ProbeView from './ProbeView.svelte';
  import Sheet from './Sheet.svelte';
  import { LANGUAGES, LANGUAGE_NAMES, pickLanguage, t, type Language } from './i18n';
  import { createApp } from './setup';
  import { exportChannelsTsl, exportFile, exportPatchTsl, fileMeta } from './export';
  import { canEdit, hasPatch, rememberedHere } from './view';
  import { SELECTABLE_CHANNELS, slotName, type SaveResult, type WriteResult } from '../state/connection';
  import type { SaveFault } from '../mock/mock-amp';
  import type { LoadResult } from '../state/connection';
  import { readPatchSource, type PatchSource } from '../storage/sources';

  type Page = 'probe' | 'fx' | 'log';

  /** How long "Undo" stays offered after a reset, revert or restore (PLAN 4.5 rule 7). */
  const UNDO_MS = 6000;
  /** How long "Saved · checked" stays; problems stay until dismissed. */
  const SAVED_NOTE_MS = 4000;

  const LANG_KEY = 'katana-studio.lang';
  /** Local date (YYYY-MM-DD) of the last complete backup (PLAN 1c: offer a backup if there is none from today). */
  const BACKUP_KEY = 'katana-studio.lastBackup';
  const today = (): string => new Date().toLocaleDateString('sv');
  function backupToday(): boolean {
    try {
      return localStorage.getItem(BACKUP_KEY) === today();
    } catch {
      return false;
    }
  }
  function rememberBackup(): void {
    try {
      localStorage.setItem(BACKUP_KEY, today());
    } catch {
      // not remembered: the next save offers a backup again
    }
  }
  function initialLanguage(): Language {
    try {
      const v = localStorage.getItem(LANG_KEY);
      if (v === 'en' || v === 'de') return v;
    } catch {
      // storage blocked: follow the phone
    }
    return pickLanguage(navigator.languages);
  }

  const app = createApp();
  const connection = app.connection;
  const store = fromStore(connection);
  const s = $derived(store.current);
  let lang = $state<Language>(initialLanguage());
  let page = $state<Page>('probe');
  let statusOpen = $state(false);
  let channelsOpen = $state(false);
  /** The last reset/revert/restore, offered for undo for a moment. */
  let undoable = $state<{ text: string; result: WriteResult } | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;

  function offerUndo(text: string, result: WriteResult): void {
    const skipped =
      result.skipped > 0 ? ` · ${t(lang, 'undo.skipped', { count: String(result.skipped) })}` : '';
    undoable = { text: text + skipped, result };
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => (undoable = null), UNDO_MS);
  }
  async function undo(): Promise<void> {
    const u = undoable;
    undoable = null;
    clearTimeout(undoTimer);
    if (u) await connection.undo(u.result);
  }
  async function restore(): Promise<void> {
    const result = await connection.restoreRemembered();
    if (result) offerUndo(t(lang, 'undo.restore'), result);
  }
  // ---- saving (PLAN 4.5 rule 10) ----
  /** The channel the open confirmation is for; null = closed. */
  let saveFor = $state<number | null>(null);
  /** Offer a backup in the confirmation: once per session, if there is none from today. */
  let saveOffer = $state(false);
  let backupOffered = false;
  /** Outcome of the last save: success disappears by itself, problems stay until dismissed. */
  let saveNote = $state<{ ok: boolean; text: string } | null>(null);
  let saveNoteTimer: ReturnType<typeof setTimeout> | undefined;

  function openSave(): void {
    if (s.patchIndex === null) return;
    saveOffer = !backupOffered && !backupToday();
    if (saveOffer) backupOffered = true;
    fileNote = null;
    saveFor = s.patchIndex;
  }
  async function backupBeforeSave(): Promise<void> {
    await backupAll();
    if (fileNote?.ok) saveOffer = false;
  }
  async function confirmSave(): Promise<void> {
    const index = saveFor;
    saveFor = null;
    if (index === null || index !== s.patchIndex) return;
    showSaveNote(await connection.save());
  }
  function showSaveNote(r: SaveResult): void {
    clearTimeout(saveNoteTimer);
    const slot = r.kind === 'refused' ? '' : slotName(r.index);
    const text = {
      saved: t(lang, 'save.saved', { slot }),
      mismatch: t(lang, 'save.mismatch', {
        slot,
        count: String(r.kind === 'mismatch' ? r.blocks.length : 0),
      }),
      'no-ack': t(lang, 'save.noAck', { slot }),
      unchecked: t(lang, 'save.unchecked', { slot }),
      aborted: t(lang, 'save.aborted', { slot }),
      refused: t(lang, 'save.refused'),
    }[r.kind];
    saveNote = { ok: r.kind === 'saved', text };
    if (r.kind === 'saved') saveNoteTimer = setTimeout(() => (saveNote = null), SAVED_NOTE_MS);
  }

  // ---- renaming (PLAN 1c) ----
  let renameText = $state<string | null>(null);
  function openRename(): void {
    if (canEdit(s)) renameText = s.patchName ?? '';
  }
  async function applyRename(): Promise<void> {
    const text = renameText;
    renameText = null;
    if (text !== null) await connection.setName(text);
  }

  // ---- loading a patch from a file (PLAN 1c: restore) ----
  let fileInput = $state<HTMLInputElement | undefined>();
  let source = $state<PatchSource | null>(null);
  let pickIndex = $state<number | null>(null);
  let loadTarget = $state(1);
  /** The patch just loaded into a channel, until saved, reverted or the channel changes. */
  let loaded = $state<{ index: number; name: string } | null>(null);

  function chooseFile(): void {
    fileNote = null;
    fileInput?.click();
  }
  async function fileChosen(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const src = readPatchSource(await file.text());
      const first = src.patches.findIndex((p) => p.complete);
      source = src;
      pickIndex = first >= 0 ? first : null;
      loadTarget =
        s.patchIndex !== null && (SELECTABLE_CHANNELS as readonly number[]).includes(s.patchIndex)
          ? s.patchIndex
          : 1;
      statusOpen = false;
    } catch (error) {
      fileNote = {
        ok: false,
        text: t(lang, 'load.badFile', { reason: error instanceof Error ? error.message : String(error) }),
      };
    }
  }
  async function confirmLoad(): Promise<void> {
    const entry = pickIndex === null ? undefined : source?.patches[pickIndex];
    source = null;
    if (!entry?.complete) return;
    const index = loadTarget;
    const r: LoadResult = await connection.loadPatch(entry.blocks, index);
    if (r.kind === 'loaded') {
      loaded = { index, name: entry.name };
      return;
    }
    const slot = slotName(index);
    saveNote = {
      ok: false,
      text:
        r.kind === 'mismatch'
          ? t(lang, 'load.mismatch', { slot, count: String(r.blocks.length) })
          : r.kind === 'aborted'
            ? t(lang, 'load.aborted', { slot })
            : t(lang, 'load.refused'),
    };
  }
  // The "loaded" banner goes when the channel changes, after saving or when nothing is unsaved any more.
  $effect(() => {
    if (loaded && (s.patchIndex !== loaded.index || (s.unsavedKnown && s.unsaved.length === 0)))
      loaded = null;
  });

  async function pickChannel(index: number): Promise<void> {
    channelsOpen = false;
    if (index !== s.patchIndex) await connection.selectChannel(index);
  }
  // An undo belongs to the patch it was made on. A derived primitive only changes with the channel, not with
  // every state update.
  const channel = $derived(s.patchIndex);
  $effect(() => {
    void channel;
    undoable = null;
    saveFor = null; // a confirmation belongs to the channel it was asked for
  });
  /** Result of the last backup or export, shown in the connection sheet. */
  let fileNote = $state<{ ok: boolean; text: string } | null>(null);

  async function backupAll(): Promise<void> {
    fileNote = null;
    try {
      const file = await connection.readBackup(fileMeta(s));
      await exportFile(file, t(lang, 'backup.title'));
      rememberBackup();
      fileNote = { ok: true, text: t(lang, 'backup.done') };
    } catch (error) {
      fileNote = { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
  }

  async function tslPatch(): Promise<void> {
    fileNote = null;
    try {
      await exportPatchTsl(connection.currentPatchFile(fileMeta(s)), t(lang, 'tsl.title'));
      fileNote = { ok: true, text: t(lang, 'tsl.done') };
    } catch (error) {
      fileNote = { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
  }

  async function tslChannels(): Promise<void> {
    fileNote = null;
    try {
      await exportChannelsTsl(await connection.readBackup(fileMeta(s)), t(lang, 'tsl.title'));
      fileNote = { ok: true, text: t(lang, 'tsl.done') };
    } catch (error) {
      fileNote = { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
  }

  async function savePatch(): Promise<void> {
    fileNote = null;
    try {
      await exportFile(connection.currentPatchFile(fileMeta(s)), t(lang, 'backup.patchTitle'));
      fileNote = { ok: true, text: t(lang, 'backup.patchDone') };
    } catch (error) {
      fileNote = { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
  }
  const remembered = $derived(rememberedHere(s));
  const shown = $derived(hasPatch(s));

  const phaseText = $derived(
    {
      starting: t(lang, 'status.starting'),
      waiting: t(lang, 'status.waiting'),
      connecting: t(lang, 'status.connecting'),
      connected: t(lang, 'status.connected', { model: s.model ?? '?' }),
      error: t(lang, 'status.error'),
    }[s.phase],
  );

  function setLanguage(l: Language): void {
    lang = l;
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      // not remembered, still switched
    }
  }

  // Browser only: actions "on the amp" for trying the app with the mock.
  function knobOnMock(): void {
    const amp = app.mock?.amp;
    const def = AMP_KNOBS[Math.floor(Math.random() * AMP_KNOBS.length)];
    if (!amp || !def) return;
    const now = amp.peek(ADDR.currentPatch + def.at)?.[0] ?? 50;
    const delta = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.floor(Math.random() * 10));
    amp.turnKnob(ADDR.currentPatch + def.at, Math.min(100, Math.max(0, now + delta)));
  }

  const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString();
  let mockFault = $state<SaveFault>('none');
  function setMockFault(f: SaveFault): void {
    mockFault = f;
    if (app.mock) app.mock.amp.saveFault = f;
  }
  const FAULTS: readonly {
    fault: SaveFault;
    key: 'mock.faultNone' | 'mock.faultNoAck' | 'mock.faultWrong';
  }[] = [
    { fault: 'none', key: 'mock.faultNone' },
    { fault: 'no-ack', key: 'mock.faultNoAck' },
    { fault: 'wrong-content', key: 'mock.faultWrong' },
  ];

  onMount(() => {
    void connection.start();
  });
</script>

<div class="app">
  <Header
    {s}
    {lang}
    onStatus={() => (statusOpen = true)}
    onChannels={() => (channelsOpen = true)}
    onRename={openRename}
  />

  {#if shown && s.phase === 'waiting'}
    <div class="banner warn">{t(lang, 'banner.frozen')}</div>
  {:else if shown && (s.phase === 'connecting' || s.phase === 'starting')}
    <div class="banner">{t(lang, 'banner.reconnecting')}</div>
  {:else if shown && s.phase === 'error'}
    <div class="banner error">
      <span>{t(lang, 'banner.error')}</span>
      <button onclick={() => void connection.connect()}>{t(lang, 'action.retry')}</button>
    </div>
  {/if}
  {#if s.readOnly && s.phase === 'connected'}
    <div class="banner warn">{t(lang, 'banner.readOnly')}</div>
  {/if}
  {#if saveNote && !saveNote.ok}
    <div class="banner error" role="alert">
      <span class="grow">{saveNote.text}</span>
      <button onclick={() => (saveNote = null)}>{t(lang, 'action.ok')}</button>
    </div>
  {/if}
  {#if loaded && !s.saving}
    <div class="banner remember">
      <span class="grow">{t(lang, 'load.loaded', { name: loaded.name, slot: slotName(loaded.index) })}</span>
      <button disabled={!canEdit(s)} onclick={openSave}>{t(lang, 'save.confirm')}</button>
    </div>
  {/if}
  {#if remembered.length > 0 && page === 'probe' && s.patchIndex !== null}
    {@const index = s.patchIndex}
    <div class="banner remember">
      <span class="grow">
        {remembered.length === 1
          ? t(lang, 'banner.remembered1')
          : t(lang, 'banner.remembered', { count: String(remembered.length) })}
      </span>
      <button class="flat" onclick={() => connection.discardRemembered(index)}>
        {t(lang, 'action.discard')}
      </button>
      <button disabled={!canEdit(s)} onclick={() => void restore()}>{t(lang, 'action.restore')}</button>
    </div>
  {/if}

  <main>
    {#if !shown && page !== 'log'}
      <div class="empty">
        {#if s.phase === 'error'}
          <p class="big error">{t(lang, 'status.error')}</p>
          <p class="detail">{s.error}</p>
          <button class="primary wide" onclick={() => void connection.connect()}>
            {t(lang, 'action.retry')}
          </button>
        {:else if s.phase === 'waiting'}
          <svg class="plug" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5" />
          </svg>
          <p class="big">{t(lang, 'empty.waiting')}</p>
          <p class="detail">{t(lang, 'empty.waitingDetail')}</p>
        {:else}
          <p class="big">{t(lang, 'empty.connecting')}</p>
        {/if}
      </div>
    {:else if page === 'probe'}
      <ProbeView {s} {lang} {connection} onUndoable={offerUndo} onSave={openSave} />
    {:else if page === 'fx'}
      <EffectsView {s} {lang} {connection} onUndoable={offerUndo} />
    {:else}
      <div class="log"><LogView {app} {lang} /></div>
    {/if}
  </main>

  {#if saveNote?.ok}
    <div class="toast saved" role="status">
      <span class="grow">{saveNote.text}</span>
    </div>
  {:else if undoable}
    <div class="toast" role="status">
      <span class="grow">{undoable.text}</span>
      <button onclick={() => void undo()}>{t(lang, 'action.undo')}</button>
    </div>
  {/if}

  <nav>
    <button class:on={page === 'probe'} onclick={() => (page = 'probe')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><circle cx="12" cy="12" r="8" /><path d="M12 12l-3.5-3.5" /></svg
      >
      {t(lang, 'tab.probe')}
    </button>
    <button class:on={page === 'fx'} onclick={() => (page = 'fx')}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="8" width="5" height="8" rx="1.5" /><rect x="16" y="8" width="5" height="8" rx="1.5" />
        <path d="M8 12h8" />
      </svg>
      {t(lang, 'tab.fx')}
    </button>
    <button class:on={page === 'log'} onclick={() => (page = 'log')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9" /></svg>
      {t(lang, 'tab.log')}
    </button>
  </nav>
</div>

{#if saveFor !== null}
  {@const slot = slotName(saveFor)}
  <Sheet
    title={t(lang, 'save.title', { slot })}
    closeLabel={t(lang, 'sheet.close')}
    onClose={() => (saveFor = null)}
  >
    <p class="detail">{t(lang, 'save.text', { name: s.patchName?.trim() ?? '', slot })}</p>
    {#if saveOffer}
      <p class="detail warntext">{t(lang, 'save.noBackup')}</p>
      <div class="pair">
        <button disabled={s.backingUp || !canEdit(s)} onclick={() => void confirmSave()}>
          {t(lang, 'save.withoutBackup')}
        </button>
        <button
          class="primary"
          disabled={s.backingUp || s.phase !== 'connected'}
          onclick={() => void backupBeforeSave()}
        >
          {s.backingUp ? t(lang, 'backup.running') : t(lang, 'save.backupFirst')}
        </button>
      </div>
    {:else}
      <div class="pair">
        <button onclick={() => (saveFor = null)}>{t(lang, 'save.cancel')}</button>
        <button class="primary" disabled={!canEdit(s)} onclick={() => void confirmSave()}>
          {t(lang, 'save.confirm')}
        </button>
      </div>
    {/if}
    {#if fileNote}
      <p class="detail" class:error={!fileNote.ok}>{fileNote.text}</p>
    {/if}
  </Sheet>
{/if}

{#if renameText !== null}
  <Sheet
    title={t(lang, 'rename.title')}
    closeLabel={t(lang, 'sheet.close')}
    onClose={() => (renameText = null)}
  >
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void applyRename();
      }}
    >
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="text"
        maxlength="24"
        bind:value={renameText}
        autofocus
        autocomplete="off"
        spellcheck="false"
      />
      <p class="sublabel">{t(lang, 'rename.hint')}</p>
      <div class="pair">
        <button type="button" onclick={() => (renameText = null)}>{t(lang, 'save.cancel')}</button>
        <button type="submit" class="primary" disabled={!canEdit(s)}>{t(lang, 'rename.apply')}</button>
      </div>
    </form>
  </Sheet>
{/if}

{#if source}
  {@const src = source}
  <Sheet title={t(lang, 'load.title')} closeLabel={t(lang, 'sheet.close')} onClose={() => (source = null)}>
    <p class="label">{t(lang, 'load.pick')}</p>
    <div class="list">
      {#each src.patches as p, i (i)}
        <button class:on={pickIndex === i} disabled={!p.complete} onclick={() => (pickIndex = i)}>
          <span class="tag">{p.label}</span>
          <span class="grow">{p.name || '–'}</span>
          {#if !p.complete}<span class="sub">{t(lang, 'load.incomplete')}</span>
          {:else if p.current && src.kind === 'backup'}<span class="sub">{t(lang, 'load.current')}</span>{/if}
        </button>
      {/each}
    </div>
    <p class="label">{t(lang, 'load.target')}</p>
    <div class="pick small">
      {#each SELECTABLE_CHANNELS as i (i)}
        <button class:on={loadTarget === i} onclick={() => (loadTarget = i)}>{PATCH_SLOT_NAMES[i]}</button>
      {/each}
    </div>
    <p class="sublabel">{t(lang, 'load.note', { slot: slotName(loadTarget) })}</p>
    <button
      class="primary wide"
      disabled={pickIndex === null || !canEdit(s)}
      onclick={() => void confirmLoad()}
    >
      {s.loading ? t(lang, 'load.running') : t(lang, 'load.confirm', { slot: slotName(loadTarget) })}
    </button>
  </Sheet>
{/if}

{#if channelsOpen}
  <Sheet
    title={t(lang, 'channels.title')}
    closeLabel={t(lang, 'sheet.close')}
    onClose={() => (channelsOpen = false)}
  >
    <div class="pick">
      {#each SELECTABLE_CHANNELS as i (i)}
        <button
          class:on={s.patchIndex === i}
          aria-current={s.patchIndex === i}
          disabled={!canEdit(s)}
          onclick={() => void pickChannel(i)}
        >
          {PATCH_SLOT_NAMES[i]}
          {#if s.remembered.has(i)}<span class="mark" aria-hidden="true"></span>{/if}
        </button>
      {/each}
    </div>
    <p class="sublabel">{t(lang, 'channels.note')}</p>
    <p class="sublabel">{t(lang, 'channels.panel')}</p>
  </Sheet>
{/if}

{#if statusOpen}
  <Sheet
    title={t(lang, 'sheet.status')}
    closeLabel={t(lang, 'sheet.close')}
    onClose={() => (statusOpen = false)}
  >
    <dl class="facts">
      <dt>{t(lang, 'fact.status')}</dt>
      <dd class={s.phase}>{phaseText}</dd>
      <dt>{t(lang, 'fact.device')}</dt>
      <dd>{s.device}</dd>
      <dt>{t(lang, 'fact.model')}</dt>
      <dd>{s.model ?? '–'}</dd>
      <dt>{t(lang, 'fact.writing')}</dt>
      <dd>{s.readOnly ? t(lang, 'fact.writingLocked') : t(lang, 'fact.writingOn')}</dd>
      <dt>{t(lang, 'fact.lastRead')}</dt>
      <dd>{s.lastReadAt === null ? '–' : fmtTime(s.lastReadAt)}</dd>
      <dt>{t(lang, 'fact.app')}</dt>
      <dd>{APP_NAME} v{APP_VERSION}</dd>
    </dl>
    {#if s.error}<p class="detail error">{s.error}</p>{/if}
    <div class="pair">
      <button disabled={s.phase !== 'connected' || s.reading} onclick={() => void connection.readCurrent()}>
        {t(lang, 'action.reread')}
      </button>
      <button onclick={() => void connection.connect()}>{t(lang, 'action.reconnect')}</button>
    </div>
    <button
      class="wide flat"
      onclick={() => {
        statusOpen = false;
        page = 'log';
      }}>{t(lang, 'action.openLog')}</button
    >

    <p class="label">{t(lang, 'backup.title')}</p>
    <div class="pair">
      <button disabled={s.phase !== 'connected' || s.reading || s.backingUp} onclick={() => void backupAll()}>
        {s.backingUp ? t(lang, 'backup.running') : t(lang, 'backup.all')}
      </button>
      <button disabled={!shown} onclick={() => void savePatch()}>{t(lang, 'backup.patch')}</button>
    </div>
    <p class="sublabel">{t(lang, 'backup.hint')}</p>
    <div class="pair">
      <button disabled={!shown} onclick={() => void tslPatch()}>{t(lang, 'tsl.patch')}</button>
      <button
        disabled={s.phase !== 'connected' || s.reading || s.backingUp}
        onclick={() => void tslChannels()}>{t(lang, 'tsl.channels')}</button
      >
    </div>
    <p class="sublabel">{t(lang, 'tsl.hint')}</p>
    <button class="wide" disabled={!canEdit(s)} onclick={chooseFile}>{t(lang, 'load.button')}</button>
    <p class="sublabel">{t(lang, 'load.hint')}</p>
    <input class="hidden" type="file" bind:this={fileInput} onchange={(e) => void fileChosen(e)} />
    {#if fileNote}
      <p class="detail" class:error={!fileNote.ok}>{fileNote.text}</p>
    {/if}

    <p class="label">{t(lang, 'fact.language')}</p>
    <div class="pair">
      {#each LANGUAGES as l (l)}
        <button class:on={lang === l} onclick={() => setLanguage(l)}>{LANGUAGE_NAMES[l]}</button>
      {/each}
    </div>

    {#if app.mock}
      {@const mock = app.mock}
      <p class="label">{t(lang, 'mock.notice')}</p>
      <p class="sublabel">{t(lang, 'mock.channel')}</p>
      <div class="channels">
        {#each [0, 1, 2, 3, 4, 5, 6, 7, 8] as i (i)}
          <button class:on={s.patchIndex === i} onclick={() => mock.amp.selectChannelOnAmp(i)}>
            {PATCH_SLOT_NAMES[i]}
          </button>
        {/each}
      </div>
      <div class="pair">
        <button onclick={knobOnMock}>{t(lang, 'mock.knob')}</button>
        <button onclick={() => mock.amp.saveOnAmp()}>{t(lang, 'mock.save')}</button>
        {#if s.phase === 'waiting'}
          <button onclick={() => mock.plug()}>{t(lang, 'mock.plug')}</button>
        {:else}
          <button onclick={() => mock.unplug()}>{t(lang, 'mock.unplug')}</button>
        {/if}
      </div>
      <p class="sublabel">{t(lang, 'mock.saveFault')}</p>
      <div class="faults">
        {#each FAULTS as f (f.fault)}
          <button class:on={mockFault === f.fault} onclick={() => setMockFault(f.fault)}
            >{t(lang, f.key)}</button
          >
        {/each}
      </div>
    {/if}

    <p class="disclaimer">{APP_SUBTITLE} · {DISCLAIMER}</p>
  </Sheet>
{/if}

<style>
  /* Exactly the screen height (safe area included), so the page never scrolls; <main> scrolls if needed. */
  .app {
    position: relative;
    box-sizing: border-box;
    max-width: 480px;
    margin: 0 auto;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    padding-top: env(safe-area-inset-top);
  }
  .banner {
    --stripe: var(--muted);
    margin: 0 14px 8px;
    padding: 8px 8px 8px 14px;
    min-height: 40px;
    box-sizing: border-box;
    border-radius: 10px;
    background: var(--panel-2);
    box-shadow: inset 3px 0 0 var(--stripe);
    font-size: 0.9rem;
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }
  .banner.warn {
    --stripe: var(--warn);
  }
  .banner.error {
    --stripe: var(--error);
  }
  .banner.remember {
    --stripe: var(--accent);
  }
  .banner button {
    min-height: 40px;
    padding: 0 12px;
    font-size: 0.85rem;
  }
  .grow {
    flex: 1;
  }
  .flat {
    background: none;
    color: var(--muted);
  }
  main {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: 4px;
  }
  .empty {
    text-align: center;
    padding: 60px 24px;
  }
  .plug {
    width: 64px;
    height: 64px;
    fill: none;
    stroke: var(--faint);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .big {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 8px 0;
  }
  .detail {
    color: var(--muted);
    word-break: break-word;
  }
  .error {
    color: var(--error);
  }
  .wide {
    width: 100%;
    margin-top: 10px;
  }
  .log {
    padding: 0 12px;
  }
  nav {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    background: var(--display);
    padding-bottom: env(safe-area-inset-bottom);
  }
  nav button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    border: none;
    border-radius: 0;
    background: transparent;
    min-height: 64px;
    color: var(--faint);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  nav svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  nav button.on {
    color: var(--accent);
  }
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    margin: 0 0 12px;
  }
  .facts dt {
    color: var(--muted);
  }
  .facts dd {
    margin: 0;
    word-break: break-word;
  }
  .facts dd.connected {
    color: var(--ok);
  }
  .facts dd.error {
    color: var(--error);
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .pair button.on,
  .channels button.on {
    border: 2px solid var(--accent);
    color: var(--accent);
  }
  .label {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 16px 0 6px;
  }
  .sublabel {
    color: var(--faint);
    font-size: 0.75rem;
    margin: 0 0 6px;
  }
  .channels {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
    margin-bottom: 8px;
  }
  .channels button {
    min-height: 44px;
    padding: 0;
    font-weight: 700;
  }
  /* Floats above the tabs, over the content, without moving it. */
  .toast {
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: calc(72px + env(safe-area-inset-bottom));
    margin: 0;
    padding: 6px 6px 6px 14px;
    border-radius: 12px;
    background: var(--panel-2);
    box-shadow: 0 4px 16px rgb(0 0 0 / 50%);
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9rem;
  }
  .hidden {
    display: none;
  }
  .text {
    width: 100%;
    box-sizing: border-box;
    min-height: 48px;
    padding: 0 14px;
    border-radius: 12px;
    border: 1px solid var(--faint);
    background: var(--panel);
    color: var(--fg);
    font: inherit;
    font-size: 1.2rem;
    margin-bottom: 8px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 40vh;
    overflow-y: auto;
  }
  .list button {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    text-align: left;
  }
  .list button.on {
    border: 2px solid var(--accent);
  }
  .tag {
    min-width: 44px;
    color: var(--accent);
    font-weight: 700;
  }
  .sub {
    color: var(--faint);
    font-size: 0.75rem;
  }
  .pick.small button {
    min-height: 48px;
    font-size: 1.1rem;
  }
  .toast.saved {
    box-shadow:
      inset 3px 0 0 var(--ok),
      0 4px 16px rgb(0 0 0 / 50%);
    min-height: 48px;
  }
  .warntext {
    color: var(--warn);
  }
  .faults {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin-bottom: 8px;
  }
  .faults button {
    min-height: 44px;
    padding: 0 6px;
    font-size: 0.8rem;
  }
  .faults button.on {
    border: 2px solid var(--accent);
    color: var(--accent);
  }
  .toast button {
    background: none;
    color: var(--accent);
    font-weight: 700;
  }
  .pick {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 12px;
  }
  .pick button {
    position: relative;
    min-height: 64px;
    font-size: 1.4rem;
    font-weight: 700;
  }
  .pick button.on {
    border: 2px solid var(--accent);
    color: var(--accent);
  }
  .pick button:disabled.on {
    opacity: 1;
  }
  .mark {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--warn);
  }
  .disclaimer {
    margin: 16px 0 0;
    color: var(--faint);
    font-size: 0.72rem;
  }
</style>
