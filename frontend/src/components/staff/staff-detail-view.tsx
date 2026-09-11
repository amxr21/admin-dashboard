'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  Activity,
  ArrowLeft,
  Building2,
  KeyRound,
  Laptop,
  LockOpen,
  Pencil,
  ShieldOff,
  Ticket,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Link } from '@/i18n/navigation';
import { ErrorSection } from '@/components/errors/error-section';
import { ResetTokenPanel } from '@/components/staff/reset-token-panel';
import { StaffPasswordPanel } from '@/components/staff/staff-password-panel';
import { StaffSheet } from '@/components/staff/staff-sheet';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Timestamp } from '@/components/timestamp';
import { useAuth } from '@/hooks/useAuth';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  fetchStaffDetail,
  issueStaffResetToken,
  revokeStaffSession,
  signOutStaffEverywhere,
  unlockStaff,
  type ResetTokenResult,
  type StaffDetail,
  type StaffSession,
} from '@/lib/staff-api';

interface StaffDetailViewProps {
  staffId: string;
}

type SessionAction = StaffSession | 'all' | null;

export function StaffDetailView({ staffId }: StaffDetailViewProps) {
  const t = useTranslations('staff.detail');
  const tStaff = useTranslations('staff');
  const tRole = useTranslations('roles');
  const tAudit = useTranslations('audit');
  const translateError = useTranslatedApiError();
  const { user } = useAuth();

  const [detail, setDetail] = useState<StaffDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);
  const [issuedToken, setIssuedToken] = useState<ResetTokenResult | null>(null);
  const [isIssuingToken, setIsIssuingToken] = useState(false);
  const [sessionAction, setSessionAction] = useState<SessionAction>(null);
  const [isApplyingSessionAction, setIsApplyingSessionAction] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setDetail(await fetchStaffDetail(staffId));
    } catch (caught) {
      setDetail(null);
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [staffId, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function unlock() {
    if (!detail) return;
    try {
      await unlockStaff(detail.staff.id);
      toast.success(tStaff('notice.unlocked', { name: detail.staff.name ?? detail.staff.email }));
      await load();
    } catch (caught) {
      toast.error(translateError(caught));
    }
  }

  async function issueToken() {
    if (!detail) return;
    setIsIssuingToken(true);
    try {
      setIssuedToken(await issueStaffResetToken(detail.staff.id));
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsIssuingToken(false);
    }
  }

  async function applySessionAction() {
    if (!detail || sessionAction === null) return;
    setIsApplyingSessionAction(true);
    try {
      if (sessionAction === 'all') {
        await signOutStaffEverywhere(detail.staff.id);
        toast.success(t('sessions.signedOutAll'));
      } else {
        await revokeStaffSession(detail.staff.id, sessionAction.id);
        toast.success(t('sessions.signedOutOne'));
      }
      setSessionAction(null);
      await load();
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsApplyingSessionAction(false);
    }
  }

  if (isLoading && !detail) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label={t('loading')}>
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Link href="/admin/staff" className="text-primary inline-flex items-center gap-2 text-sm">
          <ArrowLeft className="icon-directional size-4" aria-hidden />
          {t('back')}
        </Link>
        <ErrorSection
          title={t('loadFailed')}
          description={error ?? t('notFound')}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const { staff, profile, capabilities } = detail;
  const name = staff.name ?? staff.email;

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <Link href="/admin/staff" className="text-primary inline-flex items-center gap-2 text-sm">
          <ArrowLeft className="icon-directional size-4" aria-hidden />
          {t('back')}
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
              <Badge variant={staff.isActive ? 'secondary' : 'outline'}>
                {tStaff(staff.isActive ? 'status.active' : 'status.inactive')}
              </Badge>
              {staff.lockedUntil ? (
                <Badge variant="destructive">{tStaff('status.locked')}</Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground force-ltr mt-1 text-sm">{staff.email}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {staff.lockedUntil && capabilities.edit ? (
              <Button variant="outline" onClick={() => void unlock()}>
                <LockOpen aria-hidden />
                {tStaff('actions.unlockShort')}
              </Button>
            ) : null}
            {capabilities.edit ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                {t('actions.edit')}
              </Button>
            ) : null}
            {capabilities.manageCredentials ? (
              <>
                <Button variant="outline" onClick={() => setSettingPassword(true)}>
                  <KeyRound aria-hidden />
                  {tStaff('actions.passwordShort')}
                </Button>
                <Button onClick={() => void issueToken()} disabled={isIssuingToken}>
                  <Ticket aria-hidden />
                  {t('actions.resetToken')}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        <DetailSection icon={UserRound} title={t('identity.title')}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailField label={t('identity.role')} value={tRole(staff.role)} />
            <DetailField label={t('identity.phone')} value={staff.phone} ltr />
            <DetailField
              label={t('identity.lastLogin')}
              value={staff.lastLoginAt ? <Timestamp value={staff.lastLoginAt} /> : tStaff('never')}
            />
            <DetailField
              label={t('identity.lastSeen')}
              value={staff.lastSeenAt ? <Timestamp value={staff.lastSeenAt} /> : tStaff('never')}
            />
            <DetailField
              label={t('identity.created')}
              value={<Timestamp value={staff.createdAt} />}
            />
            <DetailField
              label={t('identity.failedLogins')}
              value={String(staff.recentFailedLogins)}
            />
            <DetailField
              label={t('identity.accessExpiry')}
              value={
                staff.accessExpiresAt ? <Timestamp value={staff.accessExpiresAt} /> : t('noExpiry')
              }
            />
          </dl>
        </DetailSection>

        <DetailSection icon={Building2} title={t('profile.title')}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailField label={t('profile.jobTitle')} value={profile.jobTitle} />
            <DetailField label={t('profile.department')} value={profile.department} />
            <DetailField
              label={t('profile.manager')}
              value={profile.manager ? profile.manager.name ?? profile.manager.email : null}
            />
            {detail.fields.map((field) => (
              <DetailField
                key={field.id}
                label={field.label}
                value={formatCustomValue(profile.values[field.id], t('yes'), t('no'))}
              />
            ))}
          </dl>
        </DetailSection>

        <DetailSection icon={Building2} title={t('branches.title')}>
          {detail.branches.length > 0 ? (
            <ul className="divide-y">
              {detail.branches.map((assignment) => (
                <li key={assignment.branch.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <Link href={`/admin/branches/${assignment.branch.id}`} className="font-medium hover:underline">
                      {assignment.branch.name}
                    </Link>
                    <p className="text-muted-foreground text-xs">{assignment.branch.business.name}</p>
                  </div>
                  <div className="text-end">
                    <p className="text-sm">{tRole(assignment.role)}</p>
                    {!assignment.branch.isActive ? (
                      <p className="text-muted-foreground text-xs">{t('branches.inactive')}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{t('branches.empty')}</p>
          )}
        </DetailSection>

        <DetailSection icon={Laptop} title={t('sessions.title')}>
          {capabilities.manageSessions && detail.sessions.length > 0 ? (
            <div className="mb-3 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setSessionAction('all')}>
                <ShieldOff aria-hidden />
                {t('sessions.signOutAll')}
              </Button>
            </div>
          ) : null}
          {detail.sessions.length > 0 ? (
            <ul className="divide-y">
              {detail.sessions.map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="force-ltr truncate text-sm font-medium" title={session.userAgent ?? undefined}>
                      {session.userAgent ?? t('sessions.unknownDevice')}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      <Timestamp value={session.lastSeenAt} />
                      {session.ip ? <span className="force-ltr"> · {session.ip}</span> : null}
                    </p>
                  </div>
                  {capabilities.manageSessions ? (
                    <Button variant="ghost" size="sm" onClick={() => setSessionAction(session)}>
                      {t('sessions.signOut')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{t('sessions.empty')}</p>
          )}
        </DetailSection>
      </div>

      <DetailSection icon={Activity} title={t('activity.title')}>
        {detail.recentActivity.length > 0 ? (
          <ul className="divide-y">
            {detail.recentActivity.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <code className="force-ltr block truncate text-xs">{entry.action}</code>
                  <p className="text-muted-foreground text-xs">
                    {entry.actorEmail ? (
                      <bdi className="force-ltr">{entry.actorEmail}</bdi>
                    ) : (
                      tAudit('systemActor')
                    )}
                  </p>
                </div>
                <Timestamp value={entry.createdAt} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t('activity.empty')}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/admin/audit?actorId=${staff.id}`} className="text-primary text-sm hover:underline">
            {t('activity.byPerson')}
          </Link>
          <Link href={`/admin/audit?entity=staff&entityId=${staff.id}`} className="text-primary text-sm hover:underline">
            {t('activity.aboutPerson')}
          </Link>
        </div>
      </DetailSection>

      {editing && user ? (
        <StaffSheet
          member={staff}
          actorRole={user.role}
          actorId={user.id}
          open
          onOpenChange={(open) => setEditing(open)}
          onSaved={(message) => {
            toast.success(message);
            setEditing(false);
            void load();
          }}
        />
      ) : null}
      {settingPassword ? (
        <StaffPasswordPanel
          member={staff}
          onDone={(message) => {
            setSettingPassword(false);
            if (message) toast.success(message);
            if (message) void load();
          }}
        />
      ) : null}
      {issuedToken ? (
        <ResetTokenPanel
          staffEmail={issuedToken.staff.email}
          token={issuedToken.token}
          expiresAt={issuedToken.expiresAt}
          onDone={() => setIssuedToken(null)}
        />
      ) : null}

      <AlertDialog open={sessionAction !== null} onOpenChange={(open) => !open && setSessionAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sessions.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {sessionAction === 'all' ? t('sessions.confirmAll') : t('sessions.confirmOne')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={isApplyingSessionAction} onClick={(event) => { event.preventDefault(); void applySessionAction(); }}>
              {t('sessions.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DetailSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  const id = `staff-detail-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="rounded-lg border p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="text-primary size-5" aria-hidden />
        <h2 id={id} className="font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function DetailField({ label, value, ltr = false }: { label: string; value: ReactNode; ltr?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={`mt-1 text-sm ${ltr ? 'force-ltr' : ''}`}>
        {value === null || value === '' || value === undefined ? '—' : value}
      </dd>
    </div>
  );
}

function formatCustomValue(value: unknown, yes: string, no: string): ReactNode {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? yes : no;
  return <bdi>{String(value)}</bdi>;
}
