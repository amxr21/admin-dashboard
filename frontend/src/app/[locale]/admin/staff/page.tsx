import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NavLabelHeading } from '@/components/shell/nav-label-heading';
import { PermissionsMatrix } from '@/components/staff/permissions-matrix';
import { StaffBranchAssignmentsLink } from '@/components/staff/staff-branch-assignments-link';
import { StaffTable } from '@/components/staff/staff-table';

/**
 * Staff — who has access, and how much of it.
 *
 * Stays a Server Component so `setRequestLocale` keeps the shell statically
 * rendered. Only OWNER and DEVELOPER reach this at all; the API refuses
 * everyone else regardless of what the nav shows.
 */
export default async function StaffPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('staff');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <NavLabelHeading labelKey="staff" defaultTitle={t('title')} />
          <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
        </div>

        <StaffBranchAssignmentsLink />
      </div>

      <StaffTable />

      <PermissionsMatrix />
    </div>
  );
}
