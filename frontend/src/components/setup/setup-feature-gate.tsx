'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useAppSettings } from '@/components/providers/settings-provider';
import { isSetupPathEnabled } from '@/lib/setup-visibility';
import type { StaffRole } from '@/config/areas';
import { Button } from '@/components/ui/button';

export function SetupFeatureGate({ pathname, role, children }: { pathname: string; role: StaffRole; children: ReactNode }) {
  const t = useTranslations('setup');
  const { enabledFeatures, isLoading } = useAppSettings();
  if (pathname === '/admin/setup' && role !== 'OWNER' && role !== 'DEVELOPER') return <p role="alert">{t('ownerOnly')}</p>;
  // Never gate on load state. `isLoading` is true on every mount, so blocking
  // here would blank every admin page on every navigation. An unknown feature
  // set fails OPEN — `isSetupPathEnabled` already treats a missing flag as
  // visible, so a disabled page flashes briefly instead of every page going
  // blank, which is the right direction for this failure to lean.
  if (isLoading || isSetupPathEnabled(pathname, enabledFeatures)) return children;
  const owner = role === 'OWNER' || role === 'DEVELOPER';
  return <section className="space-y-4"><h1 className="text-xl font-semibold">{t('disabledTitle')}</h1><p>{t(owner ? 'disabledOwner' : 'disabledStaff')}</p>{owner ? <Button asChild><Link href="/admin/setup">{t('title')}</Link></Button> : null}</section>;
}
