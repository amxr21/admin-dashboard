import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { ErrorScreen } from '../error-screen';

/**
 * `@/i18n/navigation` pulls in next/navigation, which does not resolve under
 * vitest. Same mock as sidebar-nav.test.tsx — the factory is HOISTED above
 * imports, so it cannot reference module scope and must use createElement.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

/**
 * The rule this component exists to enforce: a user never sees a status code.
 * "404" and "500" are numbers for the people who wrote the server — a visitor
 * cannot act on either, and showing them makes a recoverable moment read as a
 * broken product.
 */

describe('no status codes reach the user', () => {
  it('renders the explanation, not a code', () => {
    render(
      <ErrorScreen
        title="This page doesn't exist"
        description="The link may be out of date."
      />,
    );

    expect(screen.getByText(/this page doesn't exist/i)).toBeInTheDocument();
    expect(screen.queryByText(/\b404\b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\b500\b/)).not.toBeInTheDocument();
  });

  it('never renders a bare status number anywhere in the tree', () => {
    // Guards against a future edit dropping `{status}` into the heading.
    const { container } = render(
      <ErrorScreen title="Something went wrong" description="Try again." />,
    );

    expect(container.textContent).not.toMatch(/\b[45]\d{2}\b/);
  });
});

describe('actions', () => {
  it('offers a retry when one is possible', async () => {
    const onRetry = vi.fn();

    render(<ErrorScreen title="t" description="d" onRetry={onRetry} />);

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('omits retry when there is nothing to retry', () => {
    // A missing page does not become present by asking again. Offering the
    // button anyway teaches users the button does nothing.
    render(<ErrorScreen title="t" description="d" />);

    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('always offers a way out', () => {
    render(<ErrorScreen title="t" description="d" />);

    expect(screen.getByRole('link', { name: /back to dashboard/i })).toBeInTheDocument();
  });
});

describe('reference id', () => {
  it('shows it when present, as supporting detail', () => {
    // The one number a user SHOULD see: it maps to the backend log lines, so
    // quoting it turns an unreproducible report into a lookup.
    render(<ErrorScreen title="t" description="d" reference="abc123" />);

    const code = screen.getByText('abc123');
    expect(code).toBeInTheDocument();
    // Not the headline.
    expect(code.tagName).toBe('CODE');
  });

  it('renders the id LTR so it does not reorder in Arabic', () => {
    render(<ErrorScreen title="t" description="d" reference="abc-123" />, {
      locale: 'ar',
    });

    expect(screen.getByText('abc-123').className).toContain('force-ltr');
  });

  it('omits the reference block entirely when there is none', () => {
    render(<ErrorScreen title="t" description="d" />);

    expect(screen.queryByText(/reference/i)).not.toBeInTheDocument();
  });
});

describe('localisation', () => {
  it('translates the actions into Arabic', () => {
    render(<ErrorScreen title="عنوان" description="وصف" onRetry={() => undefined} />, {
      locale: 'ar',
    });

    expect(screen.getByRole('button', { name: 'حاول مرة أخرى' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'العودة إلى لوحة التحكم' })).toBeInTheDocument();
  });
});
