import { getPathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

/**
 * Links into /reset-password that carry a one-time token.
 *
 * The token rides in the URL FRAGMENT (`#token=…`), never the query string:
 * browsers do not send the fragment to any server, so the credential cannot
 * land in access logs, analytics, or a Referer header. The recovery page reads
 * it once and strips it from the address bar (see `PasswordRecoveryPanel`).
 */

/** The dashboard's own recovery page, absolute, in `locale`. Browser only. */
export function recoveryPageUrl(locale: Locale): string {
  return `${window.location.origin}${getPathname({ href: '/reset-password', locale })}`;
}

export function recoveryLink(locale: Locale, token: string, invite: boolean): string {
  return `${recoveryPageUrl(locale)}#token=${encodeURIComponent(token)}${invite ? '&invite=1' : ''}`;
}

export interface RecoveryFragment {
  token: string;
  /** Set by invite links, so the page can say "activate" instead of "reset". */
  invite: boolean;
}

export function readRecoveryFragment(hash: string): RecoveryFragment | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('token')?.trim();
  return token ? { token, invite: params.get('invite') === '1' } : null;
}
