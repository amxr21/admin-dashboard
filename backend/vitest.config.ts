import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // ─────────────────────────────────────────────────────────────
      // THRESHOLDS ARE 0 ON PURPOSE — there are no tests yet.
      // A threshold that fails from day one teaches everyone to ignore
      // a red CI, which is worse than having no threshold at all.
      //
      // project-test-gen raises these as it writes tests. Target:
      //   lines 70 · functions 70 · branches 65 · statements 70
      // ─────────────────────────────────────────────────────────────
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.config.{ts,mjs,js}',
        '**/*.d.ts',
        'prisma/',
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
