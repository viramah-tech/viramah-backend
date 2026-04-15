import js from '@eslint/js';
import globals from 'globals';
import n from 'eslint-plugin-n';
import security from 'eslint-plugin-security';

export default [
  js.configs.recommended,
  {
    plugins: { n, security },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      // ── Core ──────────────────────────────────────────────────────────────
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],

      // ── Node plugin ───────────────────────────────────────────────────────
      'n/no-missing-require': 'off',       // we use custom aliases and dynamic requires
      'n/no-unsupported-features/es-syntax': 'off',
      'n/no-process-exit': 'off',          // used in graceful shutdown
      'n/no-unpublished-require': 'off',

      // ── Security plugin ───────────────────────────────────────────────────
      'security/detect-object-injection': 'off',  // too many false positives in Express apps
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    ignores: ['node_modules/**', 'uploads/**', 'scratch/**', 'scripts/**'],
  },
];
