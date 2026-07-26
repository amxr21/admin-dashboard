import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/render';
import { SectionPlaceholder } from '../section-placeholder';

/**
 * Every section advertised in the navigation must render something.
 *
 * This test walks all of them because a missing translation key is a RUNTIME
 * error in next-intl — it typechecks and lints clean, then 500s in the browser.
 * Walking the real list is the only thing that catches it before the user does.
 */

const SECTIONS = ['orders', 'inventory', 'delivery', 'reports', 'staff', 'settings'];

describe('every navigable section renders', () => {
  it.each(SECTIONS)('renders %s in English', (section) => {
    render(<SectionPlaceholder section={section} />);

    // A heading proves the title key resolved; next-intl would otherwise
    // render the key path or throw.
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBeTruthy();
    expect(heading.textContent).not.toContain(section + '.title');
  });

  it.each(SECTIONS)('renders %s in Arabic', (section) => {
    render(<SectionPlaceholder section={section} />, { locale: 'ar' });

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBeTruthy();
    // A missing Arabic key falls back to the key path, which would contain a dot.
    expect(heading.textContent).not.toContain('.');
  });
});

describe('honesty about state', () => {
  it('says the section is in progress rather than pretending it works', () => {
    render(<SectionPlaceholder section="orders" />);

    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
  });

  it('lists what already works underneath', () => {
    // The page reports real progress rather than being an apology.
    render(<SectionPlaceholder section="orders" />);

    expect(screen.getByText(/already working/i)).toBeInTheDocument();
    expect(screen.getByText(/status transition rules/i)).toBeInTheDocument();
  });
});

describe('the progress list is translated', () => {
  /**
   * These bullets used to be English literals passed in as props, so the
   * Arabic page rendered right-to-left with English text inside it. Comparing
   * the two locales catches the regression that a snapshot of either one alone
   * would miss: a copy-pasted English array under the `ar` key still renders,
   * still passes a "is it non-empty" check, and is still wrong.
   */
  it.each(SECTIONS)('renders different text per locale for %s', (section) => {
    const english = render(<SectionPlaceholder section={section} />);
    const englishItems = [...english.container.querySelectorAll('li')].map(
      (item) => item.textContent,
    );

    english.unmount();

    const arabic = render(<SectionPlaceholder section={section} />, { locale: 'ar' });
    const arabicItems = [...arabic.container.querySelectorAll('li')].map(
      (item) => item.textContent,
    );

    expect(englishItems.length).toBeGreaterThan(0);
    expect(arabicItems).toHaveLength(englishItems.length);
    expect(arabicItems).not.toEqual(englishItems);
  });
});
