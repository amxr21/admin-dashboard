import { useTranslations } from 'next-intl';
import { CheckCircle2, Languages, TriangleAlert } from 'lucide-react';

import { computeTranslationCompleteness } from '@/lib/translation-completeness';

/**
 * Translation completeness (B3.7) — a Server Component reading en.json/ar.json
 * directly at render time, the same parity check `messages.test.ts` already
 * guards in CI, surfaced somewhere an admin can see it without running the
 * test suite.
 *
 * Deliberately a Server Component, no `'use client'`: both catalogues
 * together are the full message set (~50KB of JSON) that a client bundle has
 * no reason to ship twice — next-intl already sends the browser only the
 * ACTIVE locale's messages, and this panel needs both locales at once just
 * to compare them.
 *
 * Read-only by design. There is no "fix this key" action here — editing
 * `messages/en.json`/`ar.json` is a code change (a PR, a review, a deploy),
 * not a runtime admin action, the same reasoning `admin.config.ts` is a
 * compiled file rather than a database table.
 *
 * ─── WHY IT IS NOT ON THE SETTINGS PAGE ──────────────────────────────
 * It used to be. Read-only-by-design is exactly what made it wrong there: an
 * owner opening Settings expects things they can change, and this offered a
 * number whose only remedy is a developer editing a JSON file. It now renders
 * on the DEVELOPER-only /admin/configuration page with the other
 * deployment-state readouts. The file stays here beside its own test rather
 * than moving directories — nothing about it is diagnostics-specific except
 * where it is mounted, and moving it would churn its import path for no gain.
 */
export function TranslationCompletenessPanel() {
  // `diagnostics.*`, not `settings.*` — the strings moved with the panel, so
  // the namespace names the surface it actually renders on.
  const t = useTranslations('diagnostics.localisation');
  const { totalKeys, missingFromAr, missingFromEn, inSync } = computeTranslationCompleteness();

  return (
    <section aria-labelledby="settings-group-localisation" className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Languages className="text-primary size-5" aria-hidden="true" />
          <h2 id="settings-group-localisation" className="text-lg font-semibold tracking-tight">
            {t('title')}
          </h2>
        </div>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      <div className="bg-card/50 space-y-4 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          {inSync ? (
            <CheckCircle2 className="text-success size-5 shrink-0" aria-hidden="true" />
          ) : (
            <TriangleAlert className="text-warning size-5 shrink-0" aria-hidden="true" />
          )}
          <div>
            <p className="text-sm font-medium">
              {inSync
                ? t('inSync', { count: totalKeys })
                : t('outOfSync', { count: missingFromAr.length + missingFromEn.length })}
            </p>
            <p className="text-muted-foreground text-sm">{t('totalKeys', { count: totalKeys })}</p>
          </div>
        </div>

        {missingFromAr.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('missingFromAr', { count: missingFromAr.length })}</p>
            <ul className="force-ltr max-h-40 space-y-1 overflow-y-auto text-sm">
              {missingFromAr.map((key) => (
                <li key={key} className="text-muted-foreground font-mono text-xs">
                  {key}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {missingFromEn.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('missingFromEn', { count: missingFromEn.length })}</p>
            <ul className="force-ltr max-h-40 space-y-1 overflow-y-auto text-sm">
              {missingFromEn.map((key) => (
                <li key={key} className="text-muted-foreground font-mono text-xs">
                  {key}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
