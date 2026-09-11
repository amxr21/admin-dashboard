'use client';

import { useTranslations } from 'next-intl';
import { UsersRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * Keeps the Radix Slot, localized navigation link and translation hook in one
 * client boundary. Passing this Link through Button's client-side `asChild`
 * slot from the Staff Server Component causes a hydration-time render error.
 */
export function StaffBranchAssignmentsLink() {
  const t = useTranslations('staff.actions');

  return (
    <Button asChild variant="outline" className="self-start">
      <Link href="/admin/branches">
        <UsersRound aria-hidden />
        {t('manageBranchAssignments')}
      </Link>
    </Button>
  );
}
