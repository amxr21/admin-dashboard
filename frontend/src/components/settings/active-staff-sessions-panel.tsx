'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Laptop, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Timestamp } from '@/components/timestamp';
import { useAuth } from '@/hooks/useAuth';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchActiveStaffSessions, type ActiveStaffSession } from '@/lib/staff-api';

export function ActiveStaffSessionsPanel() {
  const { user } = useAuth();
  const t = useTranslations('settings.activeSessions');
  const tRole = useTranslations('roles');
  const translateError = useTranslatedApiError();
  const [sessions, setSessions] = useState<ActiveStaffSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the route's OWNER/DEVELOPER guard. Showing the panel to a role the
  // API refuses would render a permanent error box instead of a clean absence.
  const canSeeSessions = user?.role === 'OWNER' || user?.role === 'DEVELOPER';

  const refresh = useCallback(async () => {
    try {
      setSessions(await fetchActiveStaffSessions());
      setError(null);
    } catch (caught) {
      setError(translateError(caught));
    }
  }, [translateError]);

  useEffect(() => {
    if (!canSeeSessions) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [canSeeSessions, refresh]);

  if (!canSeeSessions) return null;

  return (
    <section aria-labelledby="active-staff-sessions" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="active-staff-sessions" className="flex items-center gap-2 text-lg font-semibold"><Laptop className="text-primary size-5" aria-hidden />{t('title')}</h2>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw aria-hidden />{t('refresh')}</Button>
      </div>
      <div className="bg-card/50 rounded-lg border p-4">
        {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
        {!sessions ? <p className="text-muted-foreground text-sm">{t('loading')}</p> : sessions.length === 0 ? <p className="text-muted-foreground text-sm">{t('empty')}</p> : (
          <ul className="divide-y">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{session.name ?? session.email} · {tRole(session.role)}</p><p className="text-muted-foreground force-ltr truncate text-xs">{session.email} · {session.userAgent ?? t('unknownDevice')}</p></div>
                <p className="text-muted-foreground text-xs"><Timestamp value={session.lastSeenAt} />{session.ip ? <span className="force-ltr"> · {session.ip}</span> : null}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
