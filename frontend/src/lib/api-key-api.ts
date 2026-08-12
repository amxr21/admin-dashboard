import { apiFetch } from '@/lib/api';

/**
 * Self-service API keys (B3.2). Self-only (`/auth/me/api-keys/*`) — same
 * reasoning as sessions and 2FA: a key authenticates as ITS OWNER exactly,
 * with no scope of its own (see `ApiKey`'s schema doc comment), so managing
 * your own keys needs only a session, no area grant.
 */

export interface ApiKeySummary {
  id: string;
  name: string;
  /** e.g. "adk_a1b2c3d4…9x8y" — the plaintext itself is never returned again
   * after creation. */
  keyPreview: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export async function fetchApiKeys(): Promise<ApiKeySummary[]> {
  return apiFetch<ApiKeySummary[]>('/auth/me/api-keys');
}

export interface CreatedApiKey {
  id: string;
  name: string;
  /** Plaintext, returned exactly once — same one-time-reveal contract as a
   * courier access code, password-reset token, or 2FA backup code. */
  key: string;
}

export async function createApiKey(name: string): Promise<CreatedApiKey> {
  return apiFetch<CreatedApiKey>('/auth/me/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/** Revoke one key without touching any other — independent of, and does not
 * affect, the caller's own browser session. */
export async function revokeApiKey(keyId: string): Promise<void> {
  await apiFetch<void>(`/auth/me/api-keys/${keyId}`, { method: 'DELETE' });
}
