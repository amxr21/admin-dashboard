// ESLint flat config (v9+) for Node.js + Express + TypeScript.

import tseslint from 'typescript-eslint';
import js from '@eslint/js';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // `project` (not `projectService`) so this points at tsconfig.eslint.json
        // rather than auto-discovering tsconfig.json — the build config excludes
        // **/*.test.ts (so `tsc` doesn't emit tests into dist/), which otherwise
        // makes every test file a parser error under type-aware rules
        // ("was not found by the project service").
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ─── Banned patterns ──────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',   // catches forgotten await
      '@typescript-eslint/no-misused-promises': 'error',    // catches promise in non-async context
      'no-console': 'error',                                // ALWAYS use req.log / logger — never console

      // ─── Required patterns ────────────────────────────────────
      // `null: 'ignore'` permits `x == null`, the one idiomatic use of loose
      // equality — it tests null AND undefined in a single check. Everything
      // else still requires `===`.
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-throw-literal': 'error',                          // throw Error, not strings
    },
  },
  {
    // Type-aware rules need a file to be part of the tsconfig project. Config
    // files (this one included) deliberately aren't, so linting them with the
    // type-checked ruleset is a parse error. Lint them syntactically instead.
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Config files, migrations, scripts can bend the rules.
    files: ['**/*.config.{js,mjs,ts}', 'scripts/**/*', 'prisma/**/*'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
);
