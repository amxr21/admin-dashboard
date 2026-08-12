import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import { TranslationCompletenessPanel } from '../translation-completeness-panel';

/**
 * B3.7 — translation completeness dashboard.
 *
 * The real catalogues are always in sync (CI enforces it), so this suite
 * mocks `computeTranslationCompleteness` to exercise the OUT-OF-SYNC
 * rendering path too — otherwise a real drift in the app's actual message
 * files would be the only thing that could ever prove the warning UI works.
 */

const computeTranslationCompleteness = vi.hoisted(() => vi.fn());

vi.mock('@/lib/translation-completeness', () => ({
  computeTranslationCompleteness,
}));

beforeEach(() => {
  computeTranslationCompleteness.mockReset();
});

describe('TranslationCompletenessPanel — in sync', () => {
  it('shows a success state and no missing-key lists', () => {
    computeTranslationCompleteness.mockReturnValue({
      totalKeys: 1029,
      missingFromAr: [],
      missingFromEn: [],
      inSync: true,
    });

    render(<TranslationCompletenessPanel />);

    expect(screen.getAllByText(/1,?029/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/missing from arabic/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/missing from english/i)).not.toBeInTheDocument();
  });
});

describe('TranslationCompletenessPanel — out of sync', () => {
  it('lists every key missing from Arabic', () => {
    computeTranslationCompleteness.mockReturnValue({
      totalKeys: 1029,
      missingFromAr: ['settings.newFeature.title', 'settings.newFeature.description'],
      missingFromEn: [],
      inSync: false,
    });

    render(<TranslationCompletenessPanel />);

    expect(screen.getByText('settings.newFeature.title')).toBeInTheDocument();
    expect(screen.getByText('settings.newFeature.description')).toBeInTheDocument();
    expect(screen.queryByText(/missing from english/i)).not.toBeInTheDocument();
  });

  it('lists every key missing from English separately from Arabic', () => {
    computeTranslationCompleteness.mockReturnValue({
      totalKeys: 1029,
      missingFromAr: [],
      missingFromEn: ['staff.onlyInArabic'],
      inSync: false,
    });

    render(<TranslationCompletenessPanel />);

    expect(screen.getByText('staff.onlyInArabic')).toBeInTheDocument();
    expect(screen.queryByText(/missing from arabic/i)).not.toBeInTheDocument();
  });
});
