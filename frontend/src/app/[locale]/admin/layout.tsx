import { setRequestLocale } from 'next-intl/server';

import { AdminShell } from '@/components/shell/admin-shell';

/**
 * Wraps every /admin page in the dashboard chrome, behind an auth guard.
 *
 * Stays a server component so `setRequestLocale` can keep the tree statically
 * rendered; the client work lives in AdminShell.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <AdminShell>{children}</AdminShell>;
}
