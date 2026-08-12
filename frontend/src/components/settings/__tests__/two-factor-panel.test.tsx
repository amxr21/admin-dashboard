import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { TwoFactorPanel } from '../two-factor-panel';

/**
 * B2.8 — 2FA self-service enable/disable UI.
 *
 * What's worth pinning: setup is a TWO-step flow and the backup codes only
 * appear after the SECOND step succeeds (a wrong confirmation code must not
 * reveal codes for a secret that isn't actually enforced yet), and disabling
 * requires a real code rather than firing on click — same discipline as
 * every other destructive/downgrade action in this app.
 */

const fetchTwoFactorStatus = vi.hoisted(() => vi.fn());
const beginTwoFactorSetup = vi.hoisted(() => vi.fn());
const confirmTwoFactorSetup = vi.hoisted(() => vi.fn());
const disableTwoFactor = vi.hoisted(() => vi.fn());

vi.mock('@/lib/two-factor-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/two-factor-api')>();
  return {
    ...actual,
    fetchTwoFactorStatus,
    beginTwoFactorSetup,
    confirmTwoFactorSetup,
    disableTwoFactor,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchTwoFactorStatus.mockResolvedValue({ enabled: false, remainingBackupCodes: 0 });
  beginTwoFactorSetup.mockResolvedValue({
    secret: 'ABCD1234',
    qrCodeDataUrl: 'data:image/png;base64,fake',
  });
  confirmTwoFactorSetup.mockResolvedValue({
    backupCodes: Array.from({ length: 10 }, (_, i) => `CODE${i}-XXXXX`),
  });
  disableTwoFactor.mockResolvedValue(undefined);
});

describe('TwoFactorPanel — disabled state', () => {
  it('shows Enable when 2FA is off', async () => {
    render(<TwoFactorPanel />);
    expect(await screen.findByRole('button', { name: /^enable$/i })).toBeInTheDocument();
  });
});

describe('TwoFactorPanel — setup flow', () => {
  it('does not reveal backup codes until the confirmation code succeeds', async () => {
    render(<TwoFactorPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /^enable$/i }));
    await screen.findByAltText(/qr code/i);

    // Setup started (a secret exists) but nothing has been confirmed —
    // backup codes must not be visible yet.
    expect(screen.queryByText(/CODE0-/)).not.toBeInTheDocument();
    expect(confirmTwoFactorSetup).not.toHaveBeenCalled();
  });

  it('reveals exactly the backup codes returned by a successful confirmation', async () => {
    render(<TwoFactorPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /^enable$/i }));
    await screen.findByAltText(/qr code/i);

    await userEvent.type(screen.getByLabelText(/code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verify and enable/i }));

    await waitFor(() => expect(confirmTwoFactorSetup).toHaveBeenCalledWith('123456'));
    expect(await screen.findByText('CODE0-XXXXX')).toBeInTheDocument();
    expect(screen.getByText('CODE9-XXXXX')).toBeInTheDocument();
  });

  it('stays on the code-entry step after a wrong confirmation code, with no codes shown', async () => {
    confirmTwoFactorSetup.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'That code is incorrect or expired'),
    );

    render(<TwoFactorPanel />);
    await userEvent.click(await screen.findByRole('button', { name: /^enable$/i }));
    await screen.findByAltText(/qr code/i);

    await userEvent.type(screen.getByLabelText(/code/i), '000000');
    await userEvent.click(screen.getByRole('button', { name: /verify and enable/i }));

    expect(await screen.findByText(/incorrect/i)).toBeInTheDocument();
    expect(screen.queryByText(/CODE0-/)).not.toBeInTheDocument();
  });

  it('refetches status after finishing, so Enable becomes Disable without a manual reload', async () => {
    render(<TwoFactorPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /^enable$/i }));
    await screen.findByAltText(/qr code/i);
    await userEvent.type(screen.getByLabelText(/code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verify and enable/i }));

    await screen.findByText('CODE0-XXXXX');
    fetchTwoFactorStatus.mockResolvedValue({ enabled: true, remainingBackupCodes: 10 });
    await userEvent.click(screen.getByRole('button', { name: /^done$/i }));

    await waitFor(() => expect(fetchTwoFactorStatus).toHaveBeenCalledTimes(2));
  });
});

describe('TwoFactorPanel — disable flow', () => {
  beforeEach(() => {
    fetchTwoFactorStatus.mockResolvedValue({ enabled: true, remainingBackupCodes: 7 });
  });

  it('requires a code before Disable can be confirmed', async () => {
    render(<TwoFactorPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /^disable$/i }));

    // Two "Disable" buttons exist now (the trigger, now hidden behind the
    // dialog, and the dialog's own confirm action) — the LAST one rendered
    // is the dialog's, and it must start disabled with no code typed.
    const dialogButtons = screen.getAllByRole('button', { name: /^disable$/i });
    expect(dialogButtons[dialogButtons.length - 1]).toBeDisabled();
    expect(disableTwoFactor).not.toHaveBeenCalled();
  });

  it('calls disableTwoFactor with the entered code and refreshes status', async () => {
    render(<TwoFactorPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /^disable$/i }));
    await userEvent.type(screen.getByLabelText(/code/i), '654321');

    const dialogButtons = screen.getAllByRole('button', { name: /^disable$/i });
    await userEvent.click(dialogButtons[dialogButtons.length - 1] as HTMLElement);

    await waitFor(() => expect(disableTwoFactor).toHaveBeenCalledWith('654321'));
  });
});
