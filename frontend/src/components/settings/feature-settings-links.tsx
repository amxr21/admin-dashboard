'use client';

import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@/hooks/useAuth';
import { canAccessArea } from '@/config/areas';

export function FeatureSettingsLinks() {
  const t = useTranslations('settings.features');
  const { user } = useAuth();
  if (!user) return null;
  const owner = user.role === 'OWNER' || user.role === 'DEVELOPER';
  const links = [
    { key: 'businesses', href: '/admin/branches', visible: canAccessArea(user.role, 'settings') },
    { key: 'structure', href: '/admin/settings/organization', visible: owner },
    { key: 'staff', href: '/admin/staff', visible: canAccessArea(user.role, 'staff') },
    { key: 'roles', href: '/admin/staff#staff-permissions-title', visible: owner },
    { key: 'reports', href: '/admin/reports/scheduled', visible: canAccessArea(user.role, 'reports') },
  ].filter(link => link.visible);
  return (
    <section className="space-y-3" aria-labelledby="feature-settings-title">
      <h2 id="feature-settings-title" className="text-lg font-semibold">{t('title')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map(link => (
          <Link key={link.key} href={link.href} className="bg-card hover:bg-muted rounded-lg border p-4 focus-visible:outline-2 focus-visible:outline-primary">
            <span className="flex items-center justify-between gap-2 font-medium">{t(`${link.key}.title`)}<ArrowRight aria-hidden className="icon-directional size-4" /></span>
            <p className="text-muted-foreground mt-1 text-sm">{t(`${link.key}.description`)}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
