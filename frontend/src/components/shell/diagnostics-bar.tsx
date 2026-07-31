'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, ExternalLink, TerminalSquare } from 'lucide-react';

import { fetchDiagnostics, type Diagnostics } from '@/lib/diagnostics-api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';

/**
 * DEVELOPER-only diagnostics strip — "is the deployed thing healthy, and
 * where do I look", surfaced from `GET /diagnostics` (see that route for why
 * it can never carry a secret, connection string or DSN: this is reachable
 * over the network by a real session, so it is an exfiltration target, and
 * "developer only" is one role change away from not being true).
 *
 * Collapsed by default — the collapsed line is the thing worth glancing at on
 * every page load; the migration list and observability links are one click
 * away, not always on screen.
 */

/** `3d 4h`, `2h 5m`, or `45s` — whichever units the duration actually needs. */
function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${String(days)}d ${String(hours)}h`;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`;
  if (minutes > 0) return `${String(minutes)}m ${String(seconds)}s`;
  return `${String(seconds)}s`;
}

export function DiagnosticsBar() {
  const t = useTranslations('diagnostics');
  const translateError = useTranslatedApiError();

  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchDiagnostics()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(translateError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [translateError]);

  if (error) {
    return (
      <div className="bg-muted/50 text-muted-foreground border-b px-4 py-1.5 text-xs">
        {t('label')}: {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-muted/50 border-b text-xs">
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
        className="flex w-full items-center gap-3 px-4 py-1.5 text-start"
      >
        <TerminalSquare className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        <span className="font-medium">{t('label')}</span>
        <span className="text-muted-foreground">{data.environment}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          {t('uptime')}: {formatUptime(data.uptimeSeconds)}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="flex items-center gap-1">
          <span
            className={`size-1.5 rounded-full ${data.database.reachable ? 'bg-success' : 'bg-destructive'}`}
            aria-hidden="true"
          />
          <span className="text-muted-foreground">
            {data.database.reachable ? t('databaseReachable') : t('databaseUnreachable')}
          </span>
        </span>
        {isExpanded ? (
          <ChevronUp className="ms-auto size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown className="ms-auto size-3.5 shrink-0" aria-hidden="true" />
        )}
      </button>

      {isExpanded ? (
        <div className="grid gap-4 border-t px-4 py-3 sm:grid-cols-3">
          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">{t('node')}</p>
            <p>{data.node}</p>
            <p className="text-muted-foreground font-medium">{t('database')}</p>
            <p>
              {data.database.reachable
                ? `${String(data.database.latencyMs)}ms`
                : (data.database.kind ?? t('databaseUnreachable'))}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">{t('recentMigrations')}</p>
            {data.migrations.length > 0 ? (
              <ul className="space-y-0.5">
                {data.migrations.map((migration) => (
                  <li key={migration.name} className="truncate" title={migration.name}>
                    {migration.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{t('noMigrations')}</p>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">{t('observability')}</p>
            <p className="flex items-center gap-1.5">
              {t('sentry')}:{' '}
              {data.observability.sentry.configured ? t('configured') : t('notConfigured')}
              {data.observability.sentry.dashboard ? (
                <a
                  href={data.observability.sentry.dashboard}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary inline-flex items-center gap-0.5 underline"
                >
                  {t('viewDashboard')}
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              ) : null}
            </p>
            <p className="flex items-center gap-1.5">
              {t('logs')}: {data.observability.logs.dashboard ? t('configured') : t('notConfigured')}
              {data.observability.logs.dashboard ? (
                <a
                  href={data.observability.logs.dashboard}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary inline-flex items-center gap-0.5 underline"
                >
                  {t('viewDashboard')}
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              ) : null}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
