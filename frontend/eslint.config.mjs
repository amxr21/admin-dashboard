// ESLint flat config (v9+) for Next.js + TypeScript.
// See: https://eslint.org/docs/latest/use/configure/configuration-files

import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // ─── Banned patterns ──────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',       // no `any` — use `unknown` + narrow
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }], // no stray debug logs in shipped code

      // ─── Required patterns ────────────────────────────────────
      'eqeqeq': ['error', 'always'],                        // no `==`, always `===`
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Config files can use console freely.
    files: ['**/*.config.{js,mjs,ts}', 'scripts/**/*'],
    rules: { 'no-console': 'off' },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'],
  },
];

export default config;
