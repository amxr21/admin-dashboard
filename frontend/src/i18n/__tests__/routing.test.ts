import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  LOCALES,
  getDirection,
  isLocale,
  routing,
} from '../routing';

describe('locale configuration', () => {
  it('supports English and Arabic', () => {
    expect(LOCALES).toContain('en');
    expect(LOCALES).toContain('ar');
  });

  it('defaults to a locale that actually exists', () => {
    // A default outside the list makes every unmatched request 404.
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('keeps the default locale unprefixed', () => {
    // 'as-needed' is what lets existing links and the production URL keep
    // working through this migration.
    expect(routing.localePrefix).toBe('as-needed');
  });

  it('does NOT auto-detect locale from the browser', () => {
    // With detection on, an Arabic-preferring browser opening a shared English
    // link silently gets Arabic — so sender and recipient see different pages.
    expect(routing.localeDetection).toBe(false);
  });
});

describe('getDirection', () => {
  it('returns rtl for Arabic', () => {
    expect(getDirection('ar')).toBe('rtl');
  });

  it('returns ltr for English', () => {
    expect(getDirection('en')).toBe('ltr');
  });

  it('recognises other RTL scripts', () => {
    // The set exists so adding Hebrew/Farsi/Urdu later isn't a hunt through
    // every `locale === 'ar'` comparison in the codebase.
    expect(getDirection('he')).toBe('rtl');
    expect(getDirection('fa')).toBe('rtl');
    expect(getDirection('ur')).toBe('rtl');
  });

  it('falls back to ltr for anything unknown', () => {
    // Must never throw — an unexpected locale should render, not 500.
    expect(getDirection('de')).toBe('ltr');
    expect(getDirection('')).toBe('ltr');
  });
});

describe('isLocale', () => {
  it('accepts supported locales', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ar')).toBe(true);
  });

  it('rejects unsupported ones', () => {
    expect(isLocale('de')).toBe(false);
    expect(isLocale('EN')).toBe(false); // case-sensitive on purpose
  });
});
