// ESLint config, including the layer rules of PLAN 4.1: every layer only knows the one below it,
// and the core (everything but ui/) is plain TypeScript without Svelte, the DOM framework or Capacitor.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

// Layers: midi, protocol, model, state, storage, mock, ui. Which layers a layer must NOT import from.
const FORBIDDEN = {
  midi: ['protocol', 'model', 'state', 'storage', 'mock', 'ui'],
  protocol: ['model', 'state', 'storage', 'mock', 'ui'],
  model: ['state', 'storage', 'mock', 'ui'],
  storage: ['state', 'mock', 'ui'],
  mock: ['state', 'storage', 'ui'],
  state: ['mock', 'ui'],
};

const FRAMEWORK = [
  { group: ['svelte', 'svelte/*', '*.svelte'], message: 'The core is framework-free (PLAN 4.1).' },
  {
    group: ['@capacitor/*'],
    message: 'Capacitor belongs in the Android transport or file helpers only (PLAN 4.1).',
  },
];

const layerRules = Object.entries(FORBIDDEN).map(([layer, banned]) => ({
  files: [`src/${layer}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          ...banned.map((b) => ({
            group: [`**/${b}`, `**/${b}/*`, `**/${b}/**`],
            message: `src/${layer} must not import from src/${b} (PLAN 4.1).`,
          })),
          ...FRAMEWORK,
        ],
      },
    ],
  },
}));

export default ts.config(
  {
    ignores: [
      'dist/',
      'android/',
      'usbtest/',
      'testpages/',
      'prototype/',
      'tools/',
      'captures/',
      'bts-extract/',
    ],
  },
  js.configs.recommended,
  ...ts.configs.strict,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
  ...layerRules,
  // The only places that may use Capacitor inside the core.
  {
    files: ['src/midi/android-*.ts', 'src/storage/files-*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['svelte', 'svelte/*', '*.svelte'], message: 'The core is framework-free (PLAN 4.1).' },
          ],
        },
      ],
    },
  },
  {
    files: ['*.config.js', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
