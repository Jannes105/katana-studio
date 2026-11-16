// All UI texts in one place, one table per language (PLAN section 2). English is the base language;
// parameter names stay English in every language, as on the amp.
const en = {
  'status.starting': 'Starting…',
  'status.waiting': 'Waiting for the amp: plug in the USB cable',
  'status.connecting': 'Connecting…',
  'status.connected': 'Connected, {model}',
  'status.error': 'Connection failed',
  'status.readOnly': 'The amp answered unexpectedly. Read-only: writing is locked.',
  'action.retry': 'Try again',
  'action.reread': 'Read again',
  'patch.label': 'Patch',
  'param.nsThreshold': 'NS Threshold',
  'param.locked': 'locked while reading',
  'tab.amp': 'Amp',
  'tab.log': 'Log',
  'log.copy': 'Copy log',
  'log.copyCapture': 'Copy capture',
  'log.copied': 'Copied',
  'log.copyFailed': 'Copying failed',
  'log.clear': 'Clear',
  'log.empty': 'No entries yet.',
  'log.verbose': 'Every MIDI message is in the capture, not in this log.',
  'mock.notice': 'Browser: mock amp, no real device',
  'mock.unplug': 'Unplug',
  'mock.plug': 'Plug in',
} as const;

export type TextKey = keyof typeof en;

const de: Record<TextKey, string> = {
  'status.starting': 'Starte…',
  'status.waiting': 'Warte auf den Amp: USB-Kabel einstecken',
  'status.connecting': 'Verbinde…',
  'status.connected': 'Verbunden, {model}',
  'status.error': 'Verbindung fehlgeschlagen',
  'status.readOnly': 'Der Amp hat unerwartet geantwortet. Nur lesend: Schreiben ist gesperrt.',
  'action.retry': 'Nochmal versuchen',
  'action.reread': 'Neu lesen',
  'patch.label': 'Patch',
  'param.nsThreshold': 'NS Threshold',
  'param.locked': 'gesperrt, wird gelesen',
  'tab.amp': 'Amp',
  'tab.log': 'Log',
  'log.copy': 'Log kopieren',
  'log.copyCapture': 'Mitschnitt kopieren',
  'log.copied': 'Kopiert',
  'log.copyFailed': 'Kopieren fehlgeschlagen',
  'log.clear': 'Leeren',
  'log.empty': 'Noch keine Einträge.',
  'log.verbose': 'Alle MIDI-Nachrichten stehen im Mitschnitt, nicht in diesem Log.',
  'mock.notice': 'Browser: Mock-Amp, kein echtes Gerät',
  'mock.unplug': 'Abziehen',
  'mock.plug': 'Einstecken',
};

export const TEXTS = { en, de } as const;
export type Language = keyof typeof TEXTS;

export function pickLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'de' || base === 'en') return base;
  }
  return 'en';
}

export function t(lang: Language, key: TextKey, params: Record<string, string> = {}): string {
  return TEXTS[lang][key].replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`);
}
