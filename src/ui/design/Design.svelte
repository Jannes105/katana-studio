<script lang="ts">
  // Design prototype shell (Gestaltungsrunde, PLAN 5): three directions for the rehearsal view, plus channel choice,
  // effects page, connection status/errors and log, all running against the mock amp. Throwaway code.
  import { onMount } from 'svelte';
  import { APP_VERSION } from '../../app-info';
  import { PATCH_SLOT_NAMES } from '../../protocol/address';
  import LogView from '../LogView.svelte';
  import EffectDetail from './EffectDetail.svelte';
  import Effects from './Effects.svelte';
  import Header from './Header.svelte';
  import { Proto } from './proto.svelte';
  import Sheet from './Sheet.svelte';
  import VariantA from './VariantA.svelte';
  import VariantB from './VariantB.svelte';
  import VariantC from './VariantC.svelte';

  type Direction = 'a' | 'b' | 'c';
  type Page = 'probe' | 'fx' | 'log';
  type Overlay = 'channel' | 'status' | 'save' | 'sim' | null;

  const proto = new Proto();
  const DIRECTIONS: { id: Direction; name: string }[] = [
    { id: 'a', name: 'A Fader' },
    { id: 'b', name: 'B Kacheln' },
    { id: 'c', name: 'C Regler' },
  ];

  function initialDirection(): Direction {
    const h = location.hash.slice(1);
    if (h === 'a' || h === 'b' || h === 'c') return h;
    try {
      const v = localStorage.getItem('design.direction');
      if (v === 'a' || v === 'b' || v === 'c') return v;
    } catch {
      // storage blocked: default
    }
    return 'c';
  }

  let direction = $state<Direction>(initialDirection());
  let page = $state<Page>('probe');
  let overlay = $state<Overlay>(null);
  let fxDetail = $state<string | null>(null);
  const s = $derived(proto.s);
  const remembered = $derived(proto.rememberedHere());

  function choose(d: Direction): void {
    direction = d;
    history.replaceState(null, '', `#${d}`);
    try {
      localStorage.setItem('design.direction', d);
    } catch {
      // ignore
    }
  }

  const phaseText = $derived(
    {
      starting: 'Starte…',
      waiting: 'Kein Amp: USB-Kabel einstecken',
      connecting: 'Verbinde…',
      connected: `Verbunden, ${s.model ?? '?'}`,
      error: 'Verbindung fehlgeschlagen',
    }[s.phase],
  );

  onMount(() => {
    proto.start();
    const onHash = (): void => {
      direction = initialDirection();
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  });
</script>

<div class="app">
  <div class="protobar">
    <span class="tag">Entwurf</span>
    {#each DIRECTIONS as d (d.id)}
      <button class:on={direction === d.id} onclick={() => choose(d.id)}>{d.name}</button>
    {/each}
    <button class="sim" onclick={() => (overlay = 'sim')}>Amp-Simulator</button>
  </div>

  <Header
    {proto}
    big={direction === 'b'}
    onChannel={() => (overlay = 'channel')}
    onStatus={() => (overlay = 'status')}
  />

  {#if proto.hasData && s.phase === 'waiting'}
    <div class="banner warn">Amp getrennt · Werte eingefroren, nichts wird geschrieben</div>
  {:else if proto.hasData && (s.phase === 'connecting' || s.phase === 'starting')}
    <div class="banner">Verbinde wieder…</div>
  {:else if proto.hasData && s.phase === 'error'}
    <div class="banner error">
      <span>Verbindung fehlgeschlagen</span>
      <button onclick={() => proto.retry()}>Nochmal</button>
    </div>
  {/if}
  {#if proto.readOnly && s.phase === 'connected'}
    <div class="banner warn">Nur lesend · Amp hat unerwartet geantwortet</div>
  {/if}
  {#if remembered.length > 0 && page === 'probe'}
    <div class="banner remember">
      <span class="grow"
        >{remembered.length} gemerkte {remembered.length === 1 ? 'Änderung' : 'Änderungen'}</span
      >
      <button class="flat" onclick={() => proto.discardRemembered()}>Verwerfen</button>
      <button class="primary" disabled={!proto.canWrite} onclick={() => proto.restoreRemembered()}>
        Zurückholen
      </button>
    </div>
  {/if}

  <main>
    {#if !proto.hasData && page !== 'log'}
      <div class="empty">
        {#if s.phase === 'error'}
          <p class="big error">Verbindung fehlgeschlagen</p>
          <p class="detail">{s.error}</p>
          <button class="primary wide" onclick={() => proto.retry()}>Nochmal versuchen</button>
        {:else if s.phase === 'waiting'}
          <svg class="plug" viewBox="0 0 24 24" aria-hidden="true"
            ><path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5" /></svg
          >
          <p class="big">USB-Kabel einstecken</p>
          <p class="detail">Die App verbindet sich von selbst, sobald der Amp dran ist.</p>
        {:else}
          <p class="big">Verbinde mit dem Amp…</p>
        {/if}
      </div>
    {:else if page === 'probe'}
      {#if direction === 'a'}
        <VariantA {proto} />
      {:else if direction === 'b'}
        <VariantB {proto} />
      {:else}
        <VariantC {proto} />
      {/if}
    {:else if page === 'fx' && fxDetail}
      <EffectDetail {proto} effect={fxDetail} onback={() => (fxDetail = null)} />
    {:else if page === 'fx'}
      <Effects {proto} onopen={(key) => (fxDetail = key)} />
    {:else}
      <div class="log"><LogView app={proto.app} lang="de" /></div>
    {/if}
  </main>

  {#if page === 'probe' && proto.hasData}
    <div class="actions">
      <button class="ghost" disabled={!proto.canWrite || !proto.unsaved} onclick={() => proto.resetAll()}
        >Zurücksetzen</button
      >
      <button
        class="primary"
        class:hot={proto.unsaved}
        disabled={!proto.canWrite || s.patchIndex === 0}
        onclick={() => (overlay = 'save')}>Speichern auf {proto.slot}</button
      >
    </div>
  {/if}

  {#if proto.toast}
    {@const t = proto.toast}
    <div class="toast" class:raised={page === 'probe'}>
      <span>{t.text}</span>
      {#if t.undo}
        {@const undo = t.undo}
        <button
          onclick={() => {
            undo();
            proto.toast = null;
          }}>Rückgängig</button
        >
      {/if}
    </div>
  {/if}

  <nav>
    <button class:on={page === 'probe'} onclick={() => (page = 'probe')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><circle cx="12" cy="12" r="8" /><path d="M12 12l-3.5-3.5" /></svg
      >Probe
    </button>
    <button
      class:on={page === 'fx'}
      onclick={() => {
        page = 'fx';
        fxDetail = null;
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><rect x="3" y="8" width="5" height="8" rx="1.5" /><rect
          x="16"
          y="8"
          width="5"
          height="8"
          rx="1.5"
        /><path d="M8 12h8" /></svg
      >Effekte
    </button>
    <button class:on={page === 'log'} onclick={() => (page = 'log')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9" /></svg>Log
    </button>
  </nav>
</div>

{#if overlay === 'channel'}
  <Sheet title="Kanal" onClose={() => (overlay = null)}>
    <p class="note">Meist wechselst du am Amp oder Fußschalter; die App folgt von selbst.</p>
    <div class="channels">
      {#each [1, 2, 3, 4, 5, 6, 7, 8] as i (i)}
        <button
          class:on={s.patchIndex === i}
          disabled={s.phase !== 'connected'}
          onclick={() => {
            proto.selectChannel(i);
            overlay = null;
          }}
        >
          {PATCH_SLOT_NAMES[i]}
          {#if proto.remembered[i]}<span class="dotmark" title="gemerkte Änderungen">●</span>{/if}
        </button>
      {/each}
    </div>
    {#if s.patchIndex === 0}
      <p class="note">Aktuell: Panel (nur Anzeige, nicht speicherbar).</p>
    {/if}
    <p class="note">● = ungespeicherte Änderungen gemerkt. Wechseln geht ohne Rückfrage.</p>
  </Sheet>
{:else if overlay === 'status'}
  <Sheet title="Verbindung" onClose={() => (overlay = null)}>
    <dl class="facts">
      <dt>Status</dt>
      <dd class={s.phase}>{phaseText}</dd>
      <dt>Gerät</dt>
      <dd>{s.device}</dd>
      <dt>Modell</dt>
      <dd>{s.model ?? '–'}</dd>
      <dt>Schreiben</dt>
      <dd>{proto.readOnly ? 'gesperrt (nur lesend)' : 'erlaubt'}</dd>
      <dt>App</dt>
      <dd>v{APP_VERSION}</dd>
    </dl>
    {#if s.error}<p class="detail error">{s.error}</p>{/if}
    <div class="pair">
      <button disabled={s.phase !== 'connected' || s.reading} onclick={() => proto.rereadNow()}
        >Neu lesen</button
      >
      <button onclick={() => proto.retry()}>Neu verbinden</button>
    </div>
    <button
      class="wide linkish"
      onclick={() => {
        overlay = null;
        page = 'log';
      }}>Log öffnen</button
    >
  </Sheet>
{:else if overlay === 'save'}
  <Sheet title="Speichern auf {proto.slot}?" onClose={() => (overlay = null)}>
    <p class="note">
      Der gespeicherte Stand von <strong>{proto.slot} „{(s.patchName ?? '').trim()}“</strong> wird
      überschrieben.
      {proto.unsaved ? `${proto.unsavedOffsets.length} Werte weichen ab.` : 'Es gibt keine Abweichungen.'}
    </p>
    <div class="pair">
      <button onclick={() => (overlay = null)}>Abbrechen</button>
      <button
        class="primary"
        onclick={() => {
          proto.save();
          overlay = null;
        }}>Speichern</button
      >
    </div>
  </Sheet>
{:else if overlay === 'sim'}
  <Sheet title="Amp-Simulator" onClose={() => (overlay = null)}>
    <p class="note">Nur im Entwurf: Aktionen, als kämen sie vom Amp oder vom Kabel.</p>
    <p class="label">Kanal am Amp wählen</p>
    <div class="channels small">
      {#each [1, 2, 3, 4, 5, 6, 7, 8] as i (i)}
        <button class:on={s.patchIndex === i} onclick={() => proto.channelOnAmp(i)}
          >{PATCH_SLOT_NAMES[i]}</button
        >
      {/each}
    </div>
    <div class="simgrid">
      <button onclick={() => proto.knobOnAmp()}>Regler am Amp drehen</button>
      <button onclick={() => proto.saveOnAmp()}>Am Amp speichern</button>
      {#if s.phase === 'waiting'}
        <button onclick={() => proto.plug()}>Kabel einstecken</button>
      {:else}
        <button onclick={() => proto.unplug()}>Kabel ziehen</button>
      {/if}
      {#if proto.failing}
        <button onclick={() => proto.failOff()}>Fehler beheben</button>
      {:else}
        <button onclick={() => proto.failOn()}>Amp antwortet nicht</button>
      {/if}
      <button onclick={() => (proto.fakeReadOnly = !proto.fakeReadOnly)}>
        Nur lesend {proto.fakeReadOnly ? 'aus' : 'an'}
      </button>
    </div>
  </Sheet>
{/if}

<style>
  :global(:root) {
    /* Colour mood after BOSS Tone Studio for KATANA Gen 3: near-black, white text in steps, light cyan accent,
       the amp's LED colours. Only colour values, no graphics. */
    --bg: #1a1c1f;
    --panel: #292929;
    --panel-2: #222426;
    --sheet: #2f3133;
    --display: #0d0f11;
    --knob-skirt: #1f2124;
    --knob-cap: #34373b;
    --knob-rim: rgb(255 255 255 / 14%);
    --led-off: rgb(255 255 255 / 16%);
    --line: rgb(255 255 255 / 10%);
    --track: rgb(255 255 255 / 16%);
    --fg: #ffffff;
    --muted: rgb(255 255 255 / 64%);
    --faint: rgb(255 255 255 / 36%);
    --accent: #33d6ff;
    --on-accent: #062a33;
    --fill: #1f4a55;
    --fill-changed: #5a3a1a;
    --ok: #40c057;
    --warn: #ff9f43;
    --error: #e62b0e;
    --c-green: #40c057;
    --c-red: #e62b0e;
    --c-yellow: #fcc419;
    color-scheme: dark;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: system-ui, sans-serif;
    -webkit-tap-highlight-color: transparent;
    -webkit-font-smoothing: antialiased;
  }
  :global(button) {
    font: inherit;
    color: var(--fg);
    background: var(--panel);
    border: 1px solid transparent;
    border-radius: 12px;
    padding: 10px 14px;
    min-height: 48px;
    cursor: pointer;
  }
  :global(button:disabled) {
    opacity: 0.4;
    cursor: default;
  }
  :global(button.primary) {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
    font-weight: 700;
  }
  .app {
    max-width: 480px;
    margin: 0 auto;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    padding-top: env(safe-area-inset-top);
  }
  .protobar {
    display: flex;
    gap: 4px;
    align-items: center;
    padding: 4px 8px;
    background: var(--display);
    overflow-x: auto;
  }
  .protobar .tag {
    color: var(--faint);
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 0 4px;
  }
  .protobar button {
    min-height: 30px;
    padding: 2px 10px;
    font-size: 0.75rem;
    white-space: nowrap;
    background: transparent;
    color: var(--muted);
  }
  .protobar button.on {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .protobar .sim {
    margin-left: auto;
  }
  .banner {
    --stripe: var(--muted);
    margin: 0 14px 8px;
    padding: 8px 8px 8px 14px;
    min-height: 40px;
    border-radius: 10px;
    background: var(--panel-2);
    box-shadow: inset 3px 0 0 var(--stripe);
    font-size: 0.9rem;
    display: flex;
    flex-wrap: nowrap;
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
  .grow {
    flex: 1;
  }
  .banner button {
    min-height: 40px;
    padding: 0 12px;
    font-size: 0.85rem;
  }
  .banner .flat {
    background: none;
    color: var(--muted);
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  main {
    flex: 1;
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
  .actions {
    position: sticky;
    bottom: 64px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px;
    padding: 8px 14px;
    background: var(--bg);
    border-top: 1px solid var(--line);
  }
  .actions button {
    min-height: 52px;
    font-size: 1rem;
    font-weight: 600;
  }
  .actions .ghost {
    background: none;
    color: var(--muted);
    padding: 0 12px;
  }
  .actions .primary:not(.hot) {
    background: none;
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  nav {
    position: sticky;
    bottom: 0;
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
  .toast {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: 76px;
    width: min(calc(100% - 24px), 456px);
    box-sizing: border-box;
    z-index: 40;
    background: var(--sheet);
    color: var(--fg);
    border-radius: 12px;
    padding: 8px 8px 8px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 52px;
    box-shadow:
      0 0 0 1px var(--line),
      0 12px 40px rgb(0 0 0 / 60%);
  }
  .toast.raised {
    bottom: 144px;
  }
  .toast button {
    background: transparent;
    border: none;
    color: var(--accent);
    font-weight: 700;
  }
  .note {
    color: var(--muted);
    margin: 0 0 12px;
  }
  .label {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 8px 0 6px;
  }
  .channels {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 12px;
  }
  .channels button {
    min-height: 72px;
    font-size: 1.5rem;
    font-weight: 800;
    position: relative;
  }
  .channels.small button {
    min-height: 52px;
    font-size: 1.1rem;
  }
  .channels button.on {
    border: 2px solid var(--accent);
    color: var(--accent);
  }
  .dotmark {
    position: absolute;
    top: 4px;
    right: 8px;
    font-size: 0.8rem;
    color: var(--warn);
  }
  .simgrid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
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
  }
  .facts dd.connected {
    color: var(--ok);
  }
  .facts dd.error {
    color: var(--error);
  }
  .linkish {
    background: transparent;
  }
</style>
