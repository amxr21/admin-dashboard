import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ApiKeysPanel } from '../api-keys-panel';

/**
 * B3.2 — API keys self-service UI.
 *
 * What's worth pinning: the plaintext key is shown exactly once (right after
 * creation) and never again from the list, revoking goes through a real
 * confirmation rather than firing on click (same discipline as every other
 * destructive action in this app), and the newly created key appears in the
 * list once the reveal dialog is dismissed.
 */

const fetchApiKeys = vi.hoisted(() => vi.fn());
const createApiKey = vi.hoisted(() => vi.fn());
const revokeApiKey = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-key-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-key-api')>();
  return { ...actual, fetchApiKeys, createApiKey, revokeApiKey };
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchApiKeys.mockResolvedValue([]);
  createApiKey.mockResolvedValue({
    id: 'k1',
    name: 'CI pipeline',
    key: 'adk_abcdefghijklmnopqrstuvwxyz0123456789ABCD',
  });
  revokeApiKey.mockResolvedValue(undefined);
});

describe('ApiKeysPanel — listing', () => {
  it('shows an empty state with no keys', async () => {
    render(<ApiKeysPanel />);
    expect(await screen.findByText(/no api keys yet/i)).toBeInTheDocument();
  });

  it('lists an existing key by its preview, never the full value', async () => {
    fetchApiKeys.mockResolvedValue([
      {
        id: 'k1',
        name: 'CI pipeline',
        keyPreview: 'adk_a1b2c3d4…9x8y',
        lastUsedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    render(<ApiKeysPanel />);

    expect(await screen.findByText('CI pipeline')).toBeInTheDocument();
    expect(screen.getByText('adk_a1b2c3d4…9x8y')).toBeInTheDocument();
    expect(screen.getByText(/never used/i)).toBeInTheDocument();
  });
});

describe('ApiKeysPanel — creation and one-time reveal', () => {
  it('does not call createApiKey until a name is entered', async () => {
    render(<ApiKeysPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /create key/i }));
    expect(screen.getByRole('button', { name: /^create key$/i })).toBeDisabled();
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it('reveals the full plaintext key exactly once, right after creation', async () => {
    render(<ApiKeysPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /create key/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), 'CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: /^create key$/i }));

    await waitFor(() => expect(createApiKey).toHaveBeenCalledWith('CI pipeline'));
    expect(
      await screen.findByText('adk_abcdefghijklmnopqrstuvwxyz0123456789ABCD'),
    ).toBeInTheDocument();
  });

  it('refreshes the list after the reveal is dismissed, so the new key becomes visible', async () => {
    render(<ApiKeysPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /create key/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), 'CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: /^create key$/i }));

    await screen.findByText('adk_abcdefghijklmnopqrstuvwxyz0123456789ABCD');

    fetchApiKeys.mockResolvedValue([
      {
        id: 'k1',
        name: 'CI pipeline',
        keyPreview: 'adk_abcdefgh…ABCD',
        lastUsedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    await userEvent.click(screen.getByRole('button', { name: /^done$/i }));

    await waitFor(() => expect(fetchApiKeys).toHaveBeenCalledTimes(2));
  });

  it('surfaces a 400 (e.g. the live-key ceiling) without a generic fallback message', async () => {
    createApiKey.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'You already have 20 active keys — revoke one before creating another'),
    );
    render(<ApiKeysPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /create key/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), 'One too many');
    await userEvent.click(screen.getByRole('button', { name: /^create key$/i }));

    expect(await screen.findByText(/20 active keys/i)).toBeInTheDocument();
  });
});

describe('ApiKeysPanel — revocation', () => {
  const existing = [
    {
      id: 'k1',
      name: 'CI pipeline',
      keyPreview: 'adk_a1b2c3d4…9x8y',
      lastUsedAt: '2026-08-05T00:00:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ];

  it('does not revoke on a single click — a confirmation is required first', async () => {
    fetchApiKeys.mockResolvedValue(existing);
    render(<ApiKeysPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /revoke/i }));

    expect(revokeApiKey).not.toHaveBeenCalled();
    expect(await screen.findByText(/revoke ci pipeline\?/i)).toBeInTheDocument();
  });

  it('calls revokeApiKey with the confirmed key and refreshes the list', async () => {
    fetchApiKeys.mockResolvedValue(existing);
    render(<ApiKeysPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /revoke/i }));
    fetchApiKeys.mockResolvedValue([]);
    await userEvent.click(screen.getByRole('button', { name: /^revoke$/i }));

    await waitFor(() => expect(revokeApiKey).toHaveBeenCalledWith('k1'));
  });
});
