// All UI texts in one place, one table per language (PLAN section 2). English is the base language;
// parameter names stay English in every language, as on the amp (they come from the parameter list).
const en = {
  'status.starting': 'Starting…',
  'status.waiting': 'No amp: plug in the USB cable',
  'status.connecting': 'Connecting…',
  'status.connected': 'Connected, {model}',
  'status.error': 'Connection failed',
  'status.reading': 'Reading',
  'status.usb': 'USB',

  'banner.frozen': 'Amp unplugged · values frozen, nothing is written',
  'banner.reconnecting': 'Connecting again…',
  'banner.error': 'Connection failed',
  'banner.readOnly': 'Read-only · the amp answered unexpectedly',
  'banner.remembered': '{count} remembered changes from before',
  'banner.remembered1': '1 remembered change from before',

  'empty.waiting': 'Plug in the USB cable',
  'empty.waitingDetail': 'The app connects by itself as soon as the amp is there.',
  'empty.connecting': 'Connecting to the amp…',

  'header.saved': 'Saved',
  'header.unsaved': 'Unsaved',
  'header.noPatch': 'No patch',
  'header.status': 'Connection',

  'probe.amp': 'Amp',
  'probe.ampType': 'Amp type',
  'probe.ns': 'Noise Suppressor',
  'probe.more': 'More',
  'probe.moreSub': 'Resonance',
  'probe.moreLater': 'Contour and power amp variation follow once their addresses are checked on the amp.',
  'probe.readOnlyHint': 'This version only shows values; adjusting comes with the next version.',

  'fx.later': 'Effects follow in the next step: on/off and the active variation per effect.',

  'sheet.close': 'Close',
  'sheet.status': 'Connection',
  'fact.status': 'Status',
  'fact.device': 'Device',
  'fact.model': 'Model',
  'fact.writing': 'Writing',
  'fact.writingLocked': 'locked (read-only)',
  'fact.writingOff': 'not in this version',
  'fact.app': 'App',
  'fact.language': 'Language',
  'fact.lastRead': 'Last read',

  'action.retry': 'Try again',
  'action.reread': 'Read again',
  'action.reconnect': 'Connect again',
  'action.discard': 'Discard',
  'action.openLog': 'Open log',

  'tab.probe': 'Rehearsal',
  'tab.fx': 'Effects',
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
  'mock.channel': 'Channel on the amp',
  'mock.knob': 'Turn a knob on the amp',
  'mock.save': 'Save on the amp',
} as const;

export type TextKey = keyof typeof en;

const de: Record<TextKey, string> = {
  'status.starting': 'Starte…',
  'status.waiting': 'Kein Amp: USB-Kabel einstecken',
  'status.connecting': 'Verbinde…',
  'status.connected': 'Verbunden, {model}',
  'status.error': 'Verbindung fehlgeschlagen',
  'status.reading': 'Liest',
  'status.usb': 'USB',

  'banner.frozen': 'Amp getrennt · Werte eingefroren, nichts wird geschrieben',
  'banner.reconnecting': 'Verbinde wieder…',
  'banner.error': 'Verbindung fehlgeschlagen',
  'banner.readOnly': 'Nur lesend · der Amp hat unerwartet geantwortet',
  'banner.remembered': '{count} gemerkte Änderungen von vorhin',
  'banner.remembered1': '1 gemerkte Änderung von vorhin',

  'empty.waiting': 'USB-Kabel einstecken',
  'empty.waitingDetail': 'Die App verbindet sich von selbst, sobald der Amp dran ist.',
  'empty.connecting': 'Verbinde mit dem Amp…',

  'header.saved': 'Gespeichert',
  'header.unsaved': 'Ungespeichert',
  'header.noPatch': 'Kein Patch',
  'header.status': 'Verbindung',

  'probe.amp': 'Amp',
  'probe.ampType': 'Amp-Typ',
  'probe.ns': 'Noise Suppressor',
  'probe.more': 'Mehr',
  'probe.moreSub': 'Resonance',
  'probe.moreLater': 'Contour und Endstufen-Variation folgen, sobald ihre Adressen am Amp geprüft sind.',
  'probe.readOnlyHint': 'Diese Version zeigt die Werte nur an; Einstellen kommt mit der nächsten Version.',

  'fx.later': 'Die Effekte folgen im nächsten Schritt: an/aus und die aktive Variation je Effekt.',

  'sheet.close': 'Schließen',
  'sheet.status': 'Verbindung',
  'fact.status': 'Status',
  'fact.device': 'Gerät',
  'fact.model': 'Modell',
  'fact.writing': 'Schreiben',
  'fact.writingLocked': 'gesperrt (nur lesend)',
  'fact.writingOff': 'nicht in dieser Version',
  'fact.app': 'App',
  'fact.language': 'Sprache',
  'fact.lastRead': 'Zuletzt gelesen',

  'action.retry': 'Nochmal versuchen',
  'action.reread': 'Neu lesen',
  'action.reconnect': 'Neu verbinden',
  'action.discard': 'Verwerfen',
  'action.openLog': 'Log öffnen',

  'tab.probe': 'Probe',
  'tab.fx': 'Effekte',
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
  'mock.channel': 'Kanal am Amp',
  'mock.knob': 'Regler am Amp drehen',
  'mock.save': 'Am Amp speichern',
};

export const TEXTS = { en, de } as const;
export type Language = keyof typeof TEXTS;
export const LANGUAGES: readonly Language[] = ['en', 'de'];
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { en: 'English', de: 'Deutsch' };

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
