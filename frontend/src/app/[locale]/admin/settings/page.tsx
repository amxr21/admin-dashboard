import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PageTitle } from '@/components/shell/page-title';
import { TranslationCompletenessPanel } from '@/components/settings/translation-completeness-panel';
import { DangerZonePanel } from '@/components/settings/danger-zone-panel';
import { MyAccountPanel } from '@/components/settings/my-account-panel';
import { TwoFactorPanel } from '@/components/settings/two-factor-panel';
import { SessionsPanel } from '@/components/settings/sessions-panel';
import { ApiKeysPanel } from '@/components/settings/api-keys-panel';
import { DataExportPanel } from '@/components/settings/data-export-panel';
import { PoliciesPanel } from '@/components/settings/policies-panel';
import { PersonalSettingsPanel } from '@/components/settings/personal-settings-panel';
import { SettingsForm } from '@/components/settings/settings-form';
import { FeatureSettingsLinks } from '@/components/settings/feature-settings-links';

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
      <FeatureSettingsLinks />

      {/* Personal preferences first — instant, nothing to save — then the
          server-backed store settings with their single shared save bar,
          separated by the page's own vertical rhythm (space-y-10). */}
      <MyAccountPanel />
      {/*
        O3b.2 — these three were BUILT and route-reachable but linked from
        nowhere, so the features they configure could not be turned on from
        the UI at all. That is very likely why the missing 2FA code-entry
        screen (O3b.1) went unnoticed: nobody could enable 2FA to hit it.

        Placed with My account rather than among the store settings: all
        three are about THIS person's own access — their second factor, their
        live sessions, their keys — not about how the shop is configured.
      */}
      <TwoFactorPanel />
      <SessionsPanel />
      <ApiKeysPanel />
      <PersonalSettingsPanel />
      <SettingsForm />
      <DataExportPanel />
      <TranslationCompletenessPanel />
      <PoliciesPanel />
      <DangerZonePanel />
    </div>
  );
}
