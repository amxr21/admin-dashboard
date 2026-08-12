import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PageTitle } from '@/components/shell/page-title';
import { ApiKeysPanel } from '@/components/settings/api-keys-panel';
import { DangerZonePanel } from '@/components/settings/danger-zone-panel';
import { DataExportPanel } from '@/components/settings/data-export-panel';
import { MyAccountPanel } from '@/components/settings/my-account-panel';
import { PersonalSettingsPanel } from '@/components/settings/personal-settings-panel';
import { PoliciesPanel } from '@/components/settings/policies-panel';
import { TranslationCompletenessPanel } from '@/components/settings/translation-completeness-panel';
import { SessionsPanel } from '@/components/settings/sessions-panel';
import { SettingsForm } from '@/components/settings/settings-form';
import { TwoFactorPanel } from '@/components/settings/two-factor-panel';

/**
 * Settings — one scrollable page with every section stacked top to bottom
 * (Your preferences, then Brand / Appearance / Notifications / Operations),
 * each section a header plus its fields in a two-column card grid. Replaces the
 * old category rail that hid every section but the one clicked, which read as a
 * mini-app bolted onto the dashboard rather than a settings page.
 *
 * Page title + subtitle moved to the top bar / removed (Phase 2, same
 * treatment as the dashboard) — the per-SECTION headers below (Brand,
 * Appearance, ...) stay: those aren't the page title, and nothing yet names
 * the sections the way a Phase 6 tabbed sub-nav eventually will.
 *
 * This stays a Server Component; the two interactive pieces
 * (`PersonalSettingsPanel`, `SettingsForm`) are client components it
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
      <PageTitle title={t('title')} />

      {/* Personal preferences first — instant, nothing to save — then account
          identity (its own save + a password-change flow), then how that
          identity is protected (2FA), then what it's connected to right now
          — sessions (browser) and API keys (programmatic) are the same
          concept in two forms, so they sit together — then the server-backed
          store settings with their single shared save bar, separated by the
          page's own vertical rhythm (space-y-10). */}
      <PersonalSettingsPanel />
      <MyAccountPanel />
      <TwoFactorPanel />
      <SessionsPanel />
      <ApiKeysPanel />
      <DataExportPanel />
      <PoliciesPanel />
      <TranslationCompletenessPanel />
      <SettingsForm />
      <DangerZonePanel />
    </div>
  );
}
