<script lang="ts">
  // Explanation window from below (Phase 3a): opened by a long press, changes nothing. Above every other window
  // (the "More" sheet, lists), closed by the cross or a tap on the backdrop. Texts are short enough (HELP_LIMITS)
  // that it never scrolls on a 375×667 screen.
  import { t, type Language } from '../i18n';
  import { helpFor, type HelpTarget } from './help';

  let { target, lang, onClose }: { target: HelpTarget; lang: Language; onClose: () => void } = $props();
  const text = $derived(helpFor(lang, target.key));
</script>

<div class="backdrop" role="presentation" onclick={onClose}></div>
<div class="sheet" role="dialog" aria-label={target.title}>
  <div class="head">
    <div class="titles">
      {#if target.context}<span class="ctx">{target.context}</span>{/if}
      <h2>{target.title}</h2>
    </div>
    <button onclick={onClose} aria-label={t(lang, 'sheet.close')}>✕</button>
  </div>
  {#if text}
    <p class="lead">{text.short}</p>
    <dl>
      <dt>{t(lang, 'help.what')}</dt>
      <dd>{text.what}</dd>
      <dt>{t(lang, 'help.when')}</dt>
      <dd>{text.when}</dd>
      {#if text.start}
        <dt>{t(lang, 'help.start')}</dt>
        <dd>{text.start}</dd>
      {/if}
    </dl>
    {#if text.tip}
      <p class="tip"><b>{t(lang, 'help.tip')}</b> {text.tip}</p>
    {/if}
  {:else}
    <p class="none">{t(lang, 'help.none')}</p>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 55%);
    z-index: 40;
  }
  .sheet {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: 0;
    width: min(100%, 480px);
    max-height: 85dvh;
    overflow-y: auto;
    box-sizing: border-box;
    z-index: 41;
    background: var(--sheet);
    border-radius: 22px 22px 0 0;
    padding: 12px 18px max(18px, env(safe-area-inset-bottom));
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  .ctx {
    display: block;
    font-size: 0.66rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }
  h2 {
    margin: 0;
    font-size: 1.3rem;
  }
  .head button {
    min-width: 48px;
  }
  .lead {
    margin: 8px 0 10px;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.35;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.38;
  }
  dt {
    padding-top: 2px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .tip {
    margin: 10px 0 0;
    padding: 9px 12px;
    border-radius: 12px;
    background: var(--panel-2);
    font-size: 0.86rem;
    line-height: 1.38;
  }
  .tip b {
    color: var(--c-yellow);
  }
  .none {
    color: var(--muted);
  }
</style>
