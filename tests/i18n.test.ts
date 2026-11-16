import { describe, expect, it } from 'vitest';
import { pickLanguage, t, TEXTS } from '../src/ui/i18n';

describe('i18n', () => {
  it('has the same keys in every language', () => {
    const keys = Object.keys(TEXTS.en).sort();
    for (const table of Object.values(TEXTS)) expect(Object.keys(table).sort()).toEqual(keys);
  });

  it('follows the phone language and falls back to English', () => {
    expect(pickLanguage(['de-DE', 'en'])).toBe('de');
    expect(pickLanguage(['fr-FR', 'en-GB'])).toBe('en');
    expect(pickLanguage(['fr-FR'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
  });

  it('fills placeholders', () => {
    expect(t('de', 'status.connected', { model: 'KATANA-100' })).toBe('Verbunden, KATANA-100');
    expect(t('en', 'status.connected')).toBe('Connected, {model}');
  });
});
