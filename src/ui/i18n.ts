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
  'probe.moreSub': 'Contour · Resonance · Power amp',
  'probe.contourOff': 'Off',
  'probe.freqShiftOff': 'Freq Shift: contour off',
  'probe.powerAmp': 'Power amp variation',
  'probe.readOnlyHint': 'This version only shows values; adjusting comes with the next version.',

  'fx.title': 'Effects',
  'fx.note':
    'Green, red and yellow are the three variations of an effect: three settings of their own, each with its own type, switched with the button on the amp.',
  'fx.on': 'On',
  'fx.off': 'Off',
  'fx.back': 'Back to effects',
  'fx.variation': 'Variation',
  'fx.variationNote': 'The lit one is active on the amp. Adjusting edits the active one.',
  'fx.type': 'Type',
  'fx.knobsLater1b': 'The knobs of this effect come with the next version.',
  'fx.knobsLaterPhase2': 'The knobs depend on the type; they come in a later phase.',
  'fx.typeNamesLater':
    'Type names follow once our own table of names exists; until then the number is shown.',
  'fx.nsNote': 'No variations. The same knobs are on the rehearsal tab.',
  'colour.0': 'Green',
  'colour.1': 'Red',
  'colour.2': 'Yellow',

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
  'backup.title': 'Backup',
  'backup.all': 'Back up everything',
  'backup.running': 'Reading…',
  'backup.patch': 'Save this patch',
  'backup.hint':
    'Everything = system settings, Panel, A1–B4 and the current patch, read-only, about 3 s. Saved as a file via the share menu.',
  'backup.done': 'Backup saved.',
  'backup.patchTitle': 'Patch file',
  'backup.patchDone': 'Patch saved.',
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
  'probe.moreSub': 'Contour · Resonance · Endstufe',
  'probe.contourOff': 'Aus',
  'probe.freqShiftOff': 'Freq Shift: Contour aus',
  'probe.powerAmp': 'Endstufen-Variation',
  'probe.readOnlyHint': 'Diese Version zeigt die Werte nur an; Einstellen kommt mit der nächsten Version.',

  'fx.title': 'Effekte',
  'fx.note':
    'Grün, Rot und Gelb sind die drei Variationen eines Effekts: drei eigene Einstellungen mit je eigenem Typ, umgeschaltet mit dem Taster am Amp.',
  'fx.on': 'An',
  'fx.off': 'Aus',
  'fx.back': 'Zurück zu Effekte',
  'fx.variation': 'Variation',
  'fx.variationNote': 'Die leuchtende ist am Amp aktiv. Einstellen ändert die aktive.',
  'fx.type': 'Typ',
  'fx.knobsLater1b': 'Die Regler dieses Effekts kommen mit der nächsten Version.',
  'fx.knobsLaterPhase2': 'Die Regler hängen vom Typ ab; sie kommen in einer späteren Phase.',
  'fx.typeNamesLater':
    'Typnamen folgen, sobald unsere eigene Namenstabelle steht; bis dahin steht die Nummer da.',
  'fx.nsNote': 'Keine Variationen. Dieselben Regler stehen auch im Probe-Tab.',
  'colour.0': 'Grün',
  'colour.1': 'Rot',
  'colour.2': 'Gelb',

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
  'backup.title': 'Backup',
  'backup.all': 'Alles sichern',
  'backup.running': 'Lese…',
  'backup.patch': 'Diesen Patch sichern',
  'backup.hint':
    'Alles = Systemeinstellungen, Panel, A1–B4 und der aktuelle Patch, nur lesend, rund 3 s. Gespeichert als Datei über das Teilen-Menü.',
  'backup.done': 'Backup gespeichert.',
  'backup.patchTitle': 'Patch-Datei',
  'backup.patchDone': 'Patch gespeichert.',
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
