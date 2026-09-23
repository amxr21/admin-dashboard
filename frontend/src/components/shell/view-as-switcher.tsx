'use client';

import { useTranslations } from 'next-intl';
import { Eye } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { StaffRole } from '@/config/areas';

/**
 * OWNER/DEVELOPER only — lets them see what a narrower role's sidebar looks
 * like, for demoing to a prospective client. Client-side and cosmetic ONLY:
 * every write still goes through the real server-side check with the real
 * session, regardless of what this control is set to. See app-shell.tsx for
 * where the effective role actually gets used (nav filtering + a "not
 * visible to this role" placeholder on the current page).
 */

export const PREVIEWABLE_ROLES = [
  'MANAGER',
  'FULFILLMENT',
  'CASHIER',
  'SUPPORT',
  'DEMO',
] as const satisfies readonly StaffRole[];

export function isPreviewableRole(value: string | null): value is (typeof PREVIEWABLE_ROLES)[number] {
  return value !== null && (PREVIEWABLE_ROLES as readonly string[]).includes(value);
}

interface ViewAsSwitcherProps {
  actualRole: StaffRole;
  previewedRole: StaffRole | null;
  onChange: (role: StaffRole | null) => void;
}

export function ViewAsSwitcher({ actualRole, previewedRole, onChange }: ViewAsSwitcherProps) {
  const t = useTranslations('viewAs');
  const tRoles = useTranslations('roles');

  return (
    <Select
      value={previewedRole ?? 'actual'}
      onValueChange={(value) => onChange(value === 'actual' ? null : isPreviewableRole(value) ? value : null)}
    >
      <SelectTrigger
        className="size-11 gap-1.5 px-0 text-xs sm:h-8 sm:w-auto sm:px-3"
        aria-label={t('label')}
      >
        <Eye className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="actual">
          {t('yourRole')} ({tRoles(actualRole)})
        </SelectItem>
        {PREVIEWABLE_ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {tRoles(role)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
