<script lang="ts">
  // Phase 0b test screen, replaced by the direction C UI in Phase 1a (slice 4).
  import { NS_THRESHOLD } from '../model/params';
  import { readRaw } from '../model/patch';
  import { slotName, type AmpConnection } from '../state/connection';
  import { fromStore } from 'svelte/store';
  import { t, type Language } from './i18n';

  let { connection, lang }: { connection: AmpConnection; lang: Language } = $props();

  // The connection follows the store contract; fromStore makes it reactive for runes.
  // svelte-ignore state_referenced_locally
  const store = fromStore(connection);
  const s = $derived(store.current);
  const threshold = $derived(readRaw(s.current, NS_THRESHOLD) ?? null);
  const canWrite = $derived(s.phase === 'connected' && !s.readOnly && !s.reading && threshold !== null);

  function set(v: number): void {
    void connection.setValue(NS_THRESHOLD, v);
  }

  function step(delta: number): void {
    if (threshold !== null) set(threshold + delta);
  }
</script>

<section class="status" data-phase={s.phase}>
  {#if s.phase === 'connected'}
    <p class="line ok">{t(lang, 'status.connected', { model: s.model ?? '?' })}</p>
  {:else if s.phase === 'connecting' || s.phase === 'starting'}
    <p class="line">{t(lang, s.phase === 'starting' ? 'status.starting' : 'status.connecting')}</p>
  {:else if s.phase === 'waiting'}
    <p class="line">{t(lang, 'status.waiting')}</p>
  {:else}
    <p class="line error">{t(lang, 'status.error')}</p>
    <p class="detail">{s.error}</p>
    <button onclick={() => void connection.connect()}>{t(lang, 'action.retry')}</button>
  {/if}
  {#if s.readOnly}
    <p class="readonly">{t(lang, 'status.readOnly')}</p>
  {/if}
</section>

<section class="patch">
  <p class="label">{t(lang, 'patch.label')}</p>
  <p class="value">
    <span class="slot">{slotName(s.patchIndex)}</span>
    <span class="name">{s.patchName ?? '–'}</span>
  </p>
</section>

<section class="param" class:frozen={s.phase !== 'connected'}>
  <div class="head">
    <p class="label">{t(lang, 'param.nsThreshold')}</p>
    <p class="number">{threshold ?? '–'}</p>
  </div>
  <input
    type="range"
    min={NS_THRESHOLD.min}
    max={NS_THRESHOLD.max}
    step="1"
    value={threshold ?? 0}
    disabled={!canWrite}
    aria-label={t(lang, 'param.nsThreshold')}
    oninput={(e) => set(Number(e.currentTarget.value))}
  />
  <div class="steps">
    <button disabled={!canWrite} onclick={() => step(-5)}>−5</button>
    <button disabled={!canWrite} onclick={() => step(-1)}>−1</button>
    <button disabled={!canWrite} onclick={() => step(1)}>+1</button>
    <button disabled={!canWrite} onclick={() => step(5)}>+5</button>
  </div>
  {#if s.reading}
    <p class="hint">{t(lang, 'param.locked')}</p>
  {/if}
</section>

<button
  class="reread"
  disabled={s.phase !== 'connected' || s.reading}
  onclick={() => void connection.readCurrent()}
>
  {t(lang, 'action.reread')}
</button>

<style>
  section {
    margin-top: 16px;
    padding: 14px 16px;
    border-radius: 14px;
    background: var(--panel);
  }
  p {
    margin: 0;
  }
  .line {
    font-size: 1.25rem;
    font-weight: 600;
  }
  .ok {
    color: var(--ok);
  }
  .error {
    color: var(--error);
  }
  .detail {
    margin: 6px 0 10px;
    color: var(--muted);
    font-size: 0.9rem;
    word-break: break-word;
  }
  .readonly {
    margin-top: 8px;
    color: var(--warn);
  }
  .label {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .patch .value {
    margin-top: 4px;
    font-size: 1.3rem;
    display: flex;
    gap: 10px;
    align-items: baseline;
  }
  .slot {
    color: var(--accent);
    font-weight: 700;
  }
  .param.frozen {
    opacity: 0.6;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .number {
    font-size: 2.4rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  input[type='range'] {
    width: 100%;
    height: 44px;
    margin: 8px 0;
    accent-color: var(--accent);
  }
  .steps {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .hint {
    margin-top: 8px;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .reread {
    margin-top: 16px;
    width: 100%;
  }
</style>
