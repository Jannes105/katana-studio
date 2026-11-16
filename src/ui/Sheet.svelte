<script lang="ts">
  // Window from below (no scrolling of the page behind it), closed by the cross or a tap on the backdrop.
  import type { Snippet } from 'svelte';

  let {
    title,
    closeLabel,
    onClose,
    children,
  }: { title: string; closeLabel: string; onClose: () => void; children: Snippet } = $props();
</script>

<div class="backdrop" role="presentation" onclick={onClose}></div>
<div class="sheet" role="dialog" aria-label={title}>
  <div class="head">
    <h2>{title}</h2>
    <button onclick={onClose} aria-label={closeLabel}>✕</button>
  </div>
  {@render children()}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 55%);
    z-index: 30;
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
    z-index: 31;
    background: var(--sheet);
    border-radius: 22px 22px 0 0;
    padding: 10px 16px max(18px, env(safe-area-inset-bottom));
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  h2 {
    margin: 0;
    font-size: 1.3rem;
  }
  .head button {
    min-width: 48px;
  }
</style>
