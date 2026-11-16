<script lang="ts">
  import { APP_NAME, APP_SUBTITLE, APP_VERSION, DISCLAIMER } from '../app-info';
  import { pickLanguage, t } from './i18n';

  const lang = pickLanguage(navigator.languages);
</script>

<main>
  <header>
    <h1>{APP_NAME}</h1>
    <p class="subtitle">{APP_SUBTITLE}</p>
  </header>
  <p class="status">{t(lang, 'status.disconnected')}</p>
  <p>{t(lang, 'app.placeholder')}</p>
  <footer>
    <p>v{APP_VERSION}</p>
    <p class="disclaimer">{DISCLAIMER}</p>
  </footer>
</main>

<style>
  :global(:root) {
    --bg: #111317;
    --fg: #e8eaed;
    --muted: #9aa0a6;
    --accent: #f29900;
    color-scheme: dark;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: system-ui, sans-serif;
  }
  main {
    padding: max(16px, env(safe-area-inset-top)) 16px 16px;
    max-width: 640px;
    margin: 0 auto;
  }
  h1 {
    margin: 0;
    font-size: 1.6rem;
  }
  .subtitle,
  footer {
    color: var(--muted);
  }
  .status {
    font-size: 1.2rem;
    color: var(--accent);
  }
  .disclaimer {
    font-size: 0.8rem;
  }
</style>
