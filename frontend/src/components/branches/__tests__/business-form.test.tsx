import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { Toaster } from '@/components/ui/sonner';
import { BusinessForm } from '../business-form';

/**
 * The business form (O9.2, O9.3).
 *
 * ─── WHAT THESE TESTS ARE ACTUALLY FOR ───────────────────────────────
 * The owner's complaint was that this form "is so basic, weirdly aligned to
 * the left, and what the hell is to add an image url?? we'll be using
 * cloudinary". Two of those are layout, which jsdom cannot judge — it
 * computes no real layout, and a test asserting on a Tailwind class name
 * proves only that the string is present (see the 2026-08-01 rule).
 *
 * So these cover the parts that ARE behaviour and would silently regress:
 *
 * 1. The logo is an UPLOAD control, not a text box asking for a pasted URL.
 *    The uploader already existed and was already used in Settings and the
 *    resource form; this form simply never opted in. A revert would look
 *    fine on screen and be wrong in exactly the way that was reported.
 * 2. Grouping the twelve fields must not drop any of them. Regrouping is the
 *    kind of change that loses a field to a typo in a group list, and a
 *    missing field here silently stops being savable.
 * 3. Blank optional fields still send `null` rather than `''` — the brand
 *    fallback treats an empty string as "not set", so storing one would make
 *    an unfilled business field beat a filled-in store setting.
 */

const { createBusiness, fetchBusinesses } = vi.hoisted(() => ({
  createBusiness: vi.fn(),
  fetchBusinesses: vi.fn(),
}));

vi.mock('@/lib/branches-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/branches-api')>()),
  createBusiness,
  fetchBusinesses,
}));

/** The uploader posts to Cloudinary on file choice; nothing here uploads. */
vi.mock('@/lib/upload-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upload-api')>()),
  uploadImage: vi.fn(),
}));

/** `window.location.href` is assigned on success — jsdom would warn on a real
 *  navigation, and the assertion is on the payload, not the redirect. */
beforeEach(() => {
  vi.clearAllMocks();
  createBusiness.mockResolvedValue({ id: 'biz-new' });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: '' },
  });
});

/** Every field the form must still offer after being grouped. */
const EVERY_FIELD = [
  'name',
  'legalName',
  'kind',
  'taxId',
  'email',
  'phone',
  'addressLine',
  'city',
  'country',
  'currency',
  'timezone',
] as const;

describe('the business form', () => {
  it('offers the logo as an upload, not a URL box', async () => {
    render(<BusinessForm />);

    // The uploader keeps the field's id on a FILE input. The reported bug was
    // a text box asking the owner to host the image elsewhere and paste a
    // link, so the type is the whole assertion — reverting to `<Input>` would
    // put a `text` here and nothing else on the page would look different.
    const logo = document.querySelector('#business-logoUrl') as HTMLInputElement | null;

    expect(logo).not.toBeNull();
    expect(logo?.type).toBe('file');

    // And the control that drives it is present, not just the bare input.
    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
  });

  it('still renders every field after grouping', () => {
    render(<BusinessForm />);

    // Grouping moved twelve fields into five sections. Losing one to a typo
    // in a group list would silently make it unsavable.
    for (const field of EVERY_FIELD) {
      expect(document.querySelector(`#business-${field}`)).not.toBeNull();
    }
  });

  it('refuses to save without a name', async () => {
    const user = userEvent.setup();
    render(<BusinessForm />);

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(createBusiness).not.toHaveBeenCalled();
  });

  it('sends blank optional fields as null, not empty strings', async () => {
    const user = userEvent.setup();
    render(
      <>
        <BusinessForm />
        <Toaster />
      </>,
    );

    await user.type(document.querySelector('#business-name') as HTMLInputElement, 'Corner Cafe');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(createBusiness).toHaveBeenCalled());

    const payload = createBusiness.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(payload.name).toBe('Corner Cafe');
    // An empty string here would beat a filled-in store-wide setting on the
    // invoice letterhead — the reason the form nulls them.
    expect(payload.city).toBeNull();
    expect(payload.logoUrl).toBeNull();
  });
});
