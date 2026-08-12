import { apiFetch } from '@/lib/api';

/**
 * Self-service two-factor authentication (2FA).
 *
 * All routes here are self-only (`/auth/me/2fa/*`), same reasoning as
 * `auth-api.ts`'s profile/password endpoints — a session is enough, no area
 * grant needed, since none of these can touch anyone but the caller.
 */

export interface TwoFactorStatus {
  enabled: boolean;
  /** Only meaningful when `enabled`. */
  remainingBackupCodes: number;
}

export async function fetchTwoFactorStatus(): Promise<TwoFactorStatus> {
  return apiFetch<TwoFactorStatus>('/auth/me/2fa');
}

export interface TwoFactorSetup {
  /** Raw secret, shown as a fallback for an authenticator app that can't
   * scan a QR code. */
  secret: string;
  /** `data:image/png;base64,...` — render directly in an `<img>`. */
  qrCodeDataUrl: string;
}

/** Step 1: generates a secret. Does NOT enable 2FA — see `confirmTwoFactorSetup`. */
export async function beginTwoFactorSetup(): Promise<TwoFactorSetup> {
  return apiFetch<TwoFactorSetup>('/auth/me/2fa/setup', { method: 'POST' });
}

export interface TwoFactorEnrolment {
  /** Ten codes, plaintext, returned exactly once — same one-time-reveal
   * contract as a courier access code or password-reset token. */
  backupCodes: string[];
}

/** Step 2: proves the authenticator app actually works before 2FA starts
 * being enforced on this account. */
export async function confirmTwoFactorSetup(code: string): Promise<TwoFactorEnrolment> {
  return apiFetch<TwoFactorEnrolment>('/auth/me/2fa/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

/** Requires a CURRENT code — same reasoning as changing your own password
 * requiring the current password: this is a security downgrade. */
export async function disableTwoFactor(code: string): Promise<void> {
  await apiFetch<{ ok: boolean }>('/auth/me/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}
