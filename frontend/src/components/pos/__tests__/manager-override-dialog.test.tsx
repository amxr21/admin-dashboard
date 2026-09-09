import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ManagerOverrideDialog } from '../manager-override-dialog';

/**
 * Manager override at the till (O9 Tier 4).
 *
 * ─── WHAT THESE PROTECT ──────────────────────────────────────────────
 * 1. A refused approval (wrong password, non-manager account) must keep the
 *    dialog OPEN with the refusal visible — Radix's confirm action closes on
 *    click by default, and a silent close here would strand the cashier not
 *    knowing whether anything happened.
 * 2. Cancelling clears whatever was typed. A password left in a controlled
 *    input after Cancel is a password sitting on screen for the next person
 *    to reopen the dialog and find.
 * 3. onApproved only fires on a genuine success, never on a rejection.
 */

const { requestManagerOverride } = vi.hoisted(() => ({
  requestManagerOverride: vi.fn(),
}));

vi.mock('@/lib/auth-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth-api')>()),
  requestManagerOverride,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function fillAndSubmit(email: string, password: string) {
  await userEvent.type(screen.getByLabelText(/manager email/i), email);
  await userEvent.type(screen.getByLabelText(/manager password/i), password);
  await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
}

describe('the manager override dialog', () => {
  it('calls onApproved with the result on success', async () => {
    requestManagerOverride.mockResolvedValue({
      approverId: 'm1',
      approverName: 'Sara',
      overrideToken: 'signed-token',
    });
    const onApproved = vi.fn();

    render(
      <ManagerOverrideDialog
        open
        onOpenChange={() => undefined}
        reason="20% discount, above the 10% cap"
        onApproved={onApproved}
      />,
    );

    await fillAndSubmit('sara@example.test', 'correct-password');

    await waitFor(() => {
      expect(onApproved).toHaveBeenCalledWith({
        approverId: 'm1',
        approverName: 'Sara',
        overrideToken: 'signed-token',
      });
    });
  });

  it('keeps the dialog open and shows the refusal on a wrong password', async () => {
    requestManagerOverride.mockRejectedValue(
      new ApiError(401, 'UNAUTHORIZED', 'Invalid manager email or password'),
    );
    const onApproved = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ManagerOverrideDialog
        open
        onOpenChange={onOpenChange}
        reason="20% discount, above the 10% cap"
        onApproved={onApproved}
      />,
    );

    await fillAndSubmit('sara@example.test', 'wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid manager email or password',
    );
    expect(onApproved).not.toHaveBeenCalled();
    // Never told to close — this is the "stay open" behaviour itself.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('clears the password field on cancel', async () => {
    const onOpenChange = vi.fn();

    render(
      <ManagerOverrideDialog
        open
        onOpenChange={onOpenChange}
        reason="20% discount, above the 10% cap"
        onApproved={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByLabelText(/manager password/i), 'super-secret');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows the caller-supplied reason', () => {
    render(
      <ManagerOverrideDialog
        open
        onOpenChange={() => undefined}
        reason="20% discount, above the 10% cap"
        onApproved={vi.fn()}
      />,
    );

    expect(screen.getByText('20% discount, above the 10% cap')).toBeInTheDocument();
  });
});
