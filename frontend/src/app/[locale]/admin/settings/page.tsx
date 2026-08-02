import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PersonalSettingsPanel } from '@/components/settings/personal-settings-panel';
import { SettingsForm } from '@/components/settings/settings-form';

/**
 * Settings — one scrollable page with every section stacked top to bottom
 * (Your preferences, then Brand / Appearance / Notifications / Operations),
 * each section a header plus its fields in a two-column card grid. Replaces the
 * old category rail that hid every section but the one clicked, which read as a
 * mini-app bolted onto the dashboard rather than a settings page.
 *
 * This stays a Server Component for the static title; the two interactive
 * pieces (`PersonalSettingsPanel`, `SettingsForm`) are client components it
 * composes, so no `'use client'` reaches this file.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('settings');

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      {/* Personal preferences first — instant, nothing to save — then the
          server-backed store settings with their single shared save bar,
          separated by the page's own vertical rhythm (space-y-10). */}
      <PersonalSettingsPanel />
      <SettingsForm />
    </div>
  );
}
