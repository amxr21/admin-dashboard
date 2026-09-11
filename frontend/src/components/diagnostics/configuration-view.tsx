'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, ExternalLink, Minus, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  fetchConfigurationStatus,
  type ConfigurationStatus,
  type IntegrationStatus,
} from '@/lib/diagnostics-api';

/**
 * The owner's own reference: what this environment needs configured, and what
 * is actually set right now.
 *
 * ─── WHY THIS READS THE SERVER AND DOES NOT RESTATE THE DOCS ─────────
 * `SETUP_TODO.md` already lists what to configure. A page that copied that
 * list would be a second source of truth that goes stale silently — the exact
 * failure this project has hit repeatedly with its own planning docs. This
 * reads the RUNNING server instead, so it can only ever describe the
 * environment you are actually looking at.
 *
 * ─── WHAT IT CANNOT SHOW, BY CONSTRUCTION ────────────────────────────
 * No values. The endpoint behind it returns booleans and links only (see
 * `diagnostics.route.ts`), so there is nothing here to leak even though the
 * page names every secret. The three required `*_SECRET`s are absent on
 * purpose: the server cannot boot without them, so a page that loaded at all
 * has already proven they are set.
 */

function StatusIcon({ integration }: { integration: IntegrationStatus }) {
  if (integration.configured) {
    return <Check className="text-primary size-4 shrink-0" aria-hidden />;
  }
  // Partial is the state worth interrupting for: it is almost always a typo
  // or a half-finished setup, whereas absent is usually a deliberate choice.
  if (integration.partial) {
    return <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />;
  }
  return <Minus className="text-muted-foreground size-4 shrink-0" aria-hidden />;
}

export function ConfigurationView() {
  const t = useTranslations('diagnostics.configuration');
  const translateError = useTranslatedApiError();

  const [data, setData] = useState<ConfigurationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);

    return fetchConfigurationStatus()
      .then((result) => {
        setData(result);
      })
      .catch((caught: unknown) => {
        setError(translateError(caught));
        // Clear stale content: a failed reload must not leave an older
        // environment's status on screen looking current.
        setData(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading && !data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="bg-destructive/10 text-destructive border-destructive/20 space-y-3 rounded-md border px-4 py-3 text-sm"
      >
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="size-4" aria-hidden />
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const unconfigured = data.integrations.filter((item) => !item.configured);

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">{t('environment')}</h2>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={isLoading}>
            <RefreshCw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden />
            {t('refresh')}
          </Button>
        </div>

        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground text-xs">{t('appMode')}</dt>
            {/* An identifier, not prose — must not reorder under Arabic. */}
            <dd className="force-ltr font-mono text-sm">{data.mode.appMode}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t('nodeEnv')}</dt>
            <dd className="force-ltr font-mono text-sm">{data.mode.nodeEnv}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t('corsOrigins')}</dt>
            <dd className="font-mono text-sm">{data.mode.corsOriginCount}</dd>
          </div>
        </dl>

        <p className="text-muted-foreground text-xs">{t('modeHint')}</p>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">{t('integrations')}</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {unconfigured.length === 0
              ? t('allConfigured')
              : t('someUnconfigured', { count: unconfigured.length })}
          </p>
        </div>

        <ul className="divide-y rounded-lg border">
          {data.integrations.map((integration) => (
            <li key={integration.key} className="flex gap-3 p-4">
              <StatusIcon integration={integration} />

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{t(`keys.${integration.key}`)}</span>
                  <span className="text-muted-foreground text-xs">
                    {t(`readiness.${integration.readinessCode}`)}
                  </span>
                </div>

                {/* The impact line is the point of the row: a variable name
                    alone does not tell you whether to care. */}
                {!integration.configured ? (
                  <p className="text-muted-foreground text-xs">
                    {t(`impacts.${integration.impactCode}`)}
                  </p>
                ) : null}

                {integration.dashboard ? (
                  <a
                    href={integration.dashboard}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary inline-flex items-center gap-1 text-xs underline underline-offset-4"
                  >
                    {t('openDashboard')}
                    <ExternalLink className="icon-directional size-3" aria-hidden />
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        <p className="text-muted-foreground text-xs">{t('secretsNote')}</p>
      </section>
    </div>
  );
}
