import { setRequestLocale } from 'next-intl/server';

import { AppShell } from '@/components/shell/app-shell';
import type { StaffRole } from '@/config/areas';

/**
 * Wraps every /admin page in the dashboard chrome.
 *
 * ─── PLACEHOLDER USER ────────────────────────────────────────────────
 * The shell needs a user to render the menu and decide which nav items to
 * show. Real session handling lands with the login page (group 8), which
 * replaces this constant with the authenticated user.
 *
 * Deliberately NOT a demo/owner account: MANAGER is the middle case, so
 * building against it surfaces permission-driven nav differences immediately
 * rather than after auth is wired.
 */
const PLACEHOLDER_USER = {
  name: 'Admin',
  email: 'admin@example.com',
  role: 'MANAGER' as StaffRole,
};

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <AppShell user={PLACEHOLDER_USER}>{children}</AppShell>;
}
