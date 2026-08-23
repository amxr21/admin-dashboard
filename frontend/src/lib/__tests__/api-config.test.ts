import { describe, expect, it } from 'vitest';

import { resolveApiUrl, type AppMode } from '@/lib/api-config';

/**
 * These tests exercise `resolveApiUrl` directly rather than re-importing the
 * module under a mutated `process.env`. The module's exported constants are
 * evaluated once at load, so a `vi.resetModules()` + dynamic-import dance
 * would be needed for every case — and it would test Vitest's module cache as
 * much as the logic. The pure function is the whole logic; the constants are
 * one call to it.
 */

const NONE: Record<AppMode, string | undefined> = {
  local: undefined,
  dev: undefined,
  prod: undefined,
};

const urls = (over: Partial<Record<AppMode, string>>): Record<AppMode, string | undefined> => ({
  ...NONE,
  ...over,
});

describe('resolveApiUrl', () => {
  describe('picks the URL declared for the active mode', () => {
    it('reads NEXT_PUBLIC_API_URL_LOCAL in local mode', () => {
      expect(
        resolveApiUrl('local', urls({ local: 'http://localhost:4000/api/v1' })),
      ).toBe('http://localhost:4000/api/v1');
    });

    it('reads NEXT_PUBLIC_API_URL_DEV in dev mode', () => {
      expect(resolveApiUrl('dev', urls({ dev: 'https://dev.example.com/api/v1' }))).toBe(
        'https://dev.example.com/api/v1',
      );
    });

    it('reads NEXT_PUBLIC_API_URL_PROD in prod mode', () => {
      expect(resolveApiUrl('prod', urls({ prod: 'https://api.example.com/api/v1' }))).toBe(
        'https://api.example.com/api/v1',
      );
    });

    it('ignores the URLs belonging to the other modes', () => {
      // A dev build must not quietly pick up the local URL just because it is
      // the only one set — that is the original bug in a new shape.
      expect(() => resolveApiUrl('dev', urls({ local: 'http://localhost:4000/api/v1' }))).toThrow(
        /No API URL is configured/,
      );
    });
  });

  describe('never falls back to a local backend', () => {
    it('throws when the active mode has no URL at all', () => {
      expect(() => resolveApiUrl('prod', NONE)).toThrow(/No API URL is configured/);
    });

    it('names the exact variable to set', () => {
      expect(() => resolveApiUrl('prod', NONE)).toThrow(/NEXT_PUBLIC_API_URL_PROD/);
    });

    it('treats a whitespace-only value as missing', () => {
      expect(() => resolveApiUrl('dev', urls({ dev: '   ' }))).toThrow(/No API URL is configured/);
    });

    it('treats an empty value as missing', () => {
      expect(() => resolveApiUrl('prod', urls({ prod: '' }))).toThrow(/No API URL is configured/);
    });
  });

  describe('refuses a loopback URL outside local mode', () => {
    // The core regression guard: this is precisely the config that used to
    // ship silently and make every visitor call their own machine.
    const loopbacks = [
      'http://localhost:4000/api/v1',
      'http://127.0.0.1:4000/api/v1',
      'http://0.0.0.0:4000/api/v1',
      'http://api.localhost:4000/api/v1',
    ];

    for (const url of loopbacks) {
      it(`rejects ${url} in dev mode`, () => {
        expect(() => resolveApiUrl('dev', urls({ dev: url }))).toThrow(/points at a local host/);
      });

      it(`rejects ${url} in prod mode`, () => {
        expect(() => resolveApiUrl('prod', urls({ prod: url }))).toThrow(/points at a local host/);
      });
    }

    it('rejects a loopback URL supplied through the legacy NEXT_PUBLIC_API_URL', () => {
      // The compatibility path must not be a way around the guard.
      expect(() => resolveApiUrl('prod', NONE, 'http://localhost:4000/api/v1')).toThrow(
        /points at a local host/,
      );
    });
  });

  describe('refuses a remote URL in local mode', () => {
    it('rejects a remote host so local testing cannot write to shared data', () => {
      expect(() => resolveApiUrl('local', urls({ local: 'https://api.example.com/api/v1' }))).toThrow(
        /points at a remote host/,
      );
    });
  });

  describe('legacy NEXT_PUBLIC_API_URL compatibility', () => {
    it('is used when no per-mode URL is set', () => {
      expect(resolveApiUrl('prod', NONE, 'https://api.example.com/api/v1')).toBe(
        'https://api.example.com/api/v1',
      );
    });

    it('loses to the per-mode variable when both are set', () => {
      expect(
        resolveApiUrl('prod', urls({ prod: 'https://new.example.com/api/v1' }), 'https://old.example.com/api/v1'),
      ).toBe('https://new.example.com/api/v1');
    });
  });

  describe('validates the URL shape', () => {
    it('rejects a value that is not an absolute URL', () => {
      expect(() => resolveApiUrl('prod', urls({ prod: '/api/v1' }))).toThrow(
        /not a valid absolute URL/,
      );
    });

    it('rejects a non-http protocol', () => {
      expect(() => resolveApiUrl('prod', urls({ prod: 'ftp://api.example.com/api/v1' }))).toThrow(
        /unsupported protocol/,
      );
    });

    it('strips trailing slashes so callers do not build a double slash', () => {
      expect(resolveApiUrl('prod', urls({ prod: 'https://api.example.com/api/v1///' }))).toBe(
        'https://api.example.com/api/v1',
      );
    });
  });
});
