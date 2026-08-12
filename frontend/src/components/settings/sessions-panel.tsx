'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Laptop, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Timestamp } from '@/components/timestamp';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchOwnSessions, revokeOwnSession, type SessionSummary } from '@/lib/auth-api';

/**
 * "Sessions & devices" — every device this account is currently signed in
 * on, with a per-session "sign out" that leaves every other one untouched.
 *
 * ─── WHY THIS COULDN'T EXIST BEFORE THE `Session` MODEL ──────────────
 * The ONLY revocation mechanism previously was `tokenVersion` — one counter
 * per user, bumped to kill every token at once. There was no row to point
 * at for "just that phone," so "sessions & devices" was unbuildable without
 * a schema change. That change (a new `Session` table, one row per login)
 * shipped alongside this panel.
 *
 * ─── WHY THERE IS NO "THIS DEVICE" BADGE ──────────────────────────────
 * The client never decodes its own JWT — the token is treated as opaque
 * everywhere else in this app, and adding a decoder just to highlight one
 * row would be a new pattern for one cosmetic label. `lastSeenAt` ordering
 * (most recent first) is an honest substitute: the top row is very likely
 * the one open right now, without claiming certainty the app can't back up.
 */
export function SessionsPanel() {
  const t = useTranslations('settings.sessions');
  const translateError = useTranslatedApiError();

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<SessionSummary | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setSessions(await fetchOwnSessions());
    } catch (caught) {
      setError(translateError(caught));
      setSessions(null);
    } finally {
      setIsLoading(false);
    }
  }, [translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmRevoke() {
    if (!revoking) return;

    setIsRevoking(true);
    try {
      await revokeOwnSession(revoking.id);
      toast.success(t('revoked'));
      setRevoking(null);
      await load();
    } catch (caught) {
      // An action failure is a toast, not a page-level error — the list
      // itself still loaded fine.
      toast.error(
        caught instanceof ApiError && caught.status === 404
          ? t('alreadyGone')
          : translateError(caught),
      );
    } finally {
      setIsRevoking(false);
    }
  }

  return (
    <section aria-labelledby="settings-group-sessions" className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Laptop className="text-primary size-5" aria-hidden="true" />
          <h2 id="settings-group-sessions" className="text-lg font-semibold tracking-tight">
            {t('title')}
          </h2>
        </div>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      <div className="bg-card/50 space-y-2 rounded-lg border p-4">
        {error ? (
          <div className="space-y-2">
            <p className="text-destructive text-sm">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : sessions && sessions.length > 0 ? (
          <ul className="divide-y">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p
                    className="force-ltr truncate text-sm font-medium"
                    title={session.userAgent ?? undefined}
                  >
                    {session.userAgent ?? t('unknownDevice')}
                  </p>
                  <p className="text-muted-foreground flex items-center gap-1 text-xs">
                    <span>{t('lastActivePrefix')}</span>
                    <Timestamp value={session.lastSeenAt} />
                    {session.ip ? <span className="force-ltr">· {session.ip}</span> : null}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRevoking(session)}
                >
                  <ShieldOff aria-hidden className="text-destructive" />
                  {t('signOut')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        )}
      </div>

      <AlertDialog
        open={revoking !== null}
        onOpenChange={(next) => {
          if (!next) setRevoking(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('confirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRevoking}
              onClick={(event) => {
                event.preventDefault();
                void confirmRevoke();
              }}
            >
              {t('confirm.action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
