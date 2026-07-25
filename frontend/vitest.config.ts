import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // e2e/ holds Playwright specs, which use a different `test()` global and
    // must never run under Vitest's runner — mixing them fails with a
    // confusing "no tests" error rather than a clear one.
    exclude: ['node_modules/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Thresholds are 0 — no tests exist yet. project-test-gen raises these.
      // Target once tests land: lines/functions/statements 60, branches 60.
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
      exclude: [
        'node_modules/',
        '.next/',
        '**/*.config.{ts,mjs,js}',
        '**/*.d.ts',
        'e2e/**',
        'vitest.setup.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
