import type { StaffRole } from '@prisma/client';

import { env } from '../config/env.js';
import { sendEmailToRecipients } from './email.service.js';
import { getSettingValue } from './settings.service.js';

/**
 * The invite email — the one-time activation code, plus a link straight to
 * the recovery page when the dashboard told us where that page lives.
 *
 * ─── WHY THE LINK IS CHECKED AGAINST CORS_ORIGINS ───────────────────
 * The backend does not know the dashboard's public URL; the dashboard sends
 * its own address with the invite. Mailing whatever arrived would let a
 * crafted request put a look-alike domain in a message that carries a live
 * credential. The configured CORS origins are exactly "where this dashboard
 * is served", so a link is only built when the origin is one of them and the
 * path is the recovery page. Anything else drops the link, never the invite:
 * the code alone still works.
 *
 * The token rides in the FRAGMENT (`#token=…`), which browsers never send to
 * a server — it cannot land in access logs or a Referer header on the way.
 */
export function buildActivationLink(
  activationUrl: string | undefined,
  token: string,
  allowedOrigins: readonly string[] = env.CORS_ORIGINS,
): string | null {
  if (!activationUrl) return null;

  let url: URL;
  try {
    url = new URL(activationUrl);
  } catch {
    return null;
  }

  if (!allowedOrigins.includes(url.origin)) return null;
  // `/reset-password` or a locale-prefixed `/ar/reset-password`, nothing else.
  if (!/^\/(?:[a-z]{2}\/)?reset-password$/.test(url.pathname) || url.search || url.hash) {
    return null;
  }

  return `${url.origin}${url.pathname}#token=${encodeURIComponent(token)}&invite=1`;
}

export interface StaffInviteEmail {
  email: string;
  name: string | null;
  role: StaffRole;
  token: string;
  expiresAt: Date;
  activationUrl?: string | undefined;
}

/** `OWNER` → `Owner`. The email is plain text, so no i18n catalogue here. */
function roleLabel(role: StaffRole): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * Send the invite. Same "never throws" contract as every sender in
 * email.service.ts: `false` means not configured or not delivered, and the
 * invite itself has already succeeded either way — the admin still has the
 * link and code on screen.
 */
export async function sendStaffInviteEmail(invite: StaffInviteEmail): Promise<boolean> {
  const storeName = (await getSettingValue('store.name')).trim() || 'the dashboard';
  const link = buildActivationLink(invite.activationUrl, invite.token);

  const lines = [
    `Hello${invite.name ? ` ${invite.name}` : ''},`,
    '',
    `You have been given access to ${storeName} as ${roleLabel(invite.role)}.`,
    '',
    ...(link
      ? [
          'Open this link to choose your password:',
          '',
          `    ${link}`,
          '',
          'If the link does not open, enter this one-time code on the password page instead:',
        ]
      : ['On the dashboard sign-in page, choose "Forgot your password?" and enter this one-time code:']),
    '',
    `    ${invite.token}`,
    '',
    `It works once and expires ${invite.expiresAt.toUTCString()}.`,
    'If you were not expecting this invitation, you can ignore this message.',
  ];

  return sendEmailToRecipients([invite.email], `You're invited to ${storeName}`, lines.join('\n'));
}
