'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { LogIn, LogOut, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';

import { DataTable, type Column } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import {
  fetchLoginHistory,
  type LoginHistoryEntry,
  type LoginHistoryResult,
} from '@/lib/staff-api';

/**
 * Who signed in, who failed, and from where.
 *
 * ─── A FAILURE MUST NOT LOOK LIKE A SUCCESS ──────────────────────────
 * The whole reason this page exists is that a burst of failed attempts
 * against one account was invisible. So outcome is carried by an ICON and a
 * label, never by colour alone — red/green is invisible to roughly 1 in 12
 * men, and this is precisely the "status colour" case where a shape is
 * mandatory rather than nice.
 *
 * ─── A FAILED ATTEMPT HAS NO ACTOR, BY DESIGN ────────────────────────
 * A rejected login has not proved who was trying, so the server records no
 * `actorId` and puts the ATTEMPTED email in `changes.email` instead. This
 * component therefore falls back to that email and marks it as attempted —
 * showing it as though it were a confirmed identity would be a lie, and
 * showing nothing would hide the one fact a reviewer needs.
 */

/** Which events read as a refusal, for the icon. Derived from the action
 *  rather than from `outcome` alone so a future action gets a sensible
 *  default instead of silently rendering as a success. */
const FAILURE_ACTIONS = new Set(['auth.login.failed', 'auth.login.2fa-failed']);

const URL_DEFAULTS = { page: '1', outcome: '', from: '', to: '' };

export function LoginHistoryTable() {
  const t = useTranslations('loginHistory');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const { values, setValues, clear } = useUrlState(URL_DEFAULTS);

  const page = Math.max(1, Number(values.page) || 1);
  const outcome = values.outcome === 'DENIED' ? 'DENIED' : undefined;

  const [result, setResult] = useState<LoginHistoryResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(
        await fetchLoginHistory({
          page,
          pageSize: 25,
          ...(outcome ? { outcome } : {}),
          ...(values.from ? { from: values.from } : {}),
          ...(values.to ? { to: values.to } : {}),
        }),
      );
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [page, outcome, values.from, values.to, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasFilters = Boolean(values.outcome || values.from || values.to);

  // `clear` takes the keys to drop, so it cannot be passed straight to an
  // onClick — the click event would arrive as its first argument.
  const clearFilters = useCallback(() => {
    clear(['outcome', 'from', 'to', 'page']);
  }, [clear]);

  const columns: Column<LoginHistoryEntry>[] = useMemo(
    () => [
      {
        id: 'outcome',
        header: t('columns.event'),
        cell: (row) => {
          const failed = FAILURE_ACTIONS.has(row.action) || row.outcome === 'DENIED';
          const Icon = failed
            ? row.action.includes('2fa')
              ? ShieldAlert
              : XCircle
            : row.action === 'auth.logout'
              ? LogOut
              : row.action.includes('2fa')
                ? ShieldCheck
                : LogIn;

          return (
            <div className="flex items-center gap-2">
              {/* Icon AND text. Never colour alone — see the note above. */}
              <Icon
                className={failed ? 'text-destructive size-4 shrink-0' : 'text-muted-foreground size-4 shrink-0'}
                aria-hidden
              />
              <span className={failed ? 'text-destructive text-sm font-medium' : 'text-sm'}>
                {/* next-intl reads a dot as a nesting separator, so an
                    action name like `auth.login.succeeded` cannot be a key —
                    it would be looked up as three levels deep and silently
                    miss. Dots become underscores in the message file. */}
                {eventLabel(t, row.action)}
              </span>
            </div>
          );
        },
      },
      {
        id: 'who',
        header: t('columns.who'),
        cell: (row) => {
          const attempted = attemptedEmail(row.changes);

          // A confirmed identity and an attempted one must not render alike.
          if (row.actorEmail) {
            return (
              <div className="min-w-0">
                <p className="truncate text-sm">{row.actorEmail}</p>
                {row.actorRole ? (
                  <p className="text-muted-foreground text-xs">{row.actorRole}</p>
                ) : null}
              </div>
            );
          }

          if (attempted) {
            return (
              <div className="min-w-0">
                <p className="truncate text-sm">{attempted}</p>
                <p className="text-muted-foreground text-xs">{t('attempted')}</p>
              </div>
            );
          }

          return <span className="text-muted-foreground text-sm">{t('unknownActor')}</span>;
        },
      },
      {
        id: 'reason',
        header: t('columns.reason'),
        cell: (row) => {
          const reason = failureReason(row.changes);
          return reason ? (
            <code className="force-ltr text-xs">{reason}</code>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          );
        },
      },
      {
        id: 'where',
        header: t('columns.where'),
        cell: (row) => (
          <div className="min-w-0">
            {/* An IP is null where there is no trustworthy answer, never a
                guess — so say "not recorded" rather than showing a blank. */}
            <code className="force-ltr block text-xs">{row.ip ?? t('noIp')}</code>
            {row.userAgent ? (
              <p className="text-muted-foreground max-w-xs truncate text-xs" title={row.userAgent}>
                {row.userAgent}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: 'when',
        header: t('columns.when'),
        cell: (row) => (
          <span className="text-sm whitespace-nowrap tabular-nums">
            {formatter.dateTime(new Date(row.createdAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
        ),
      },
    ],
    [t, formatter],
  );

  const totalPages = result?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-44 space-y-2">
          <Label htmlFor="login-history-outcome">{t('filters.outcome')}</Label>
          <Select
            value={values.outcome || 'all'}
            onValueChange={(next) =>
              setValues({ outcome: next === 'all' ? null : next, page: null })
            }
          >
            <SelectTrigger id="login-history-outcome">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.allOutcomes')}</SelectItem>
              <SelectItem value="DENIED">{t('filters.failuresOnly')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="login-history-from">{t('filters.from')}</Label>
          <DatePicker
            id="login-history-from"
            value={values.from ?? ''}
            onChange={(next) => setValues({ from: next || null, page: null })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="login-history-to">{t('filters.to')}</Label>
          <DatePicker
            id="login-history-to"
            value={values.to ?? ''}
            onChange={(next) => setValues({ to: next || null, page: null })}
          />
        </div>

        {hasFilters ? (
          <Button variant="ghost" onClick={clearFilters}>
            {t('filters.clear')}
          </Button>
        ) : null}
      </div>

      <DataTable
        data={result?.entries ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        emptyMessage={
          <EmptyState
            icon={hasFilters ? ShieldCheck : LogIn}
            title={hasFilters ? t('emptyFiltered') : t('empty')}
            description={hasFilters ? t('emptyFilteredHint') : t('emptyHint')}
            {...(hasFilters
              ? { action: { label: t('filters.clear'), onClick: clearFilters, icon: XCircle } }
              : {})}
          />
        }
      />

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isLoading}
            onClick={() => setValues({ page: String(page - 1) })}
          >
            {t('pagination.previous')}
          </Button>
          <span className="text-sm tabular-nums">
            {t('pageOf', { page, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isLoading}
            onClick={() => setValues({ page: String(page + 1) })}
          >
            {t('pagination.next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Translate an action name, falling back to the raw name so a NEW event
 *  shows something truthful rather than an empty cell. */
function eventLabel(t: ReturnType<typeof useTranslations<'loginHistory'>>, action: string): string {
  const key = `events.${action.replace(/\./g, '_')}`;
  return t.has(key) ? t(key) : action;
}

/** The email someone TRIED to sign in with, on a failed attempt. */
function attemptedEmail(changes: Record<string, unknown> | null): string | null {
  const value = changes?.email;
  return typeof value === 'string' ? value : null;
}

/** The server's own reason code for a refusal, e.g. INVALID_CREDENTIALS. */
function failureReason(changes: Record<string, unknown> | null): string | null {
  const value = changes?.reason;
  return typeof value === 'string' ? value : null;
}
