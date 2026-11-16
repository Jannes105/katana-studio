// All UI texts in one place, one table per language (PLAN section 2). English is the base language;
// parameter names stay English in every language, as on the amp.
const en = {
  'status.disconnected': 'Not connected',
  'status.connecting': 'Connecting…',
  'status.connected': 'Connected, {model}',
  'app.placeholder': 'Phase 0b scaffold: nothing to edit yet.',
} as const;

export type TextKey = keyof typeof en;

const de: Record<TextKey, string> = {
  'status.disconnected': 'Nicht verbunden',
  'status.connecting': 'Verbinde…',
  'status.connected': 'Verbunden, {model}',
  'app.placeholder': 'Gerüst für Phase 0b: noch nichts zu bearbeiten.',
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
