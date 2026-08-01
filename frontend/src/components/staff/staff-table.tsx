'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { KeyRound, LockOpen, Pencil, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';

import { DataTable, type Column } from '@/components/data-table';
import { StaffSheet } from '@/components/staff/staff-sheet';
import { StaffPasswordPanel } from '@/components/staff/staff-password-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useAppSettings } from '@/components/providers/settings-provider';
import {
  canModify,
  fetchStaff,
  unlockStaff,
  type StaffListResult,
  type StaffMember,
  type StaffRole,
} from '@/lib/staff-api';

/**
 * Who has access, and how much.
 *
 * ─── THE UI MIRRORS THE SERVER'S RULES, IT DOES NOT ENFORCE THEM ─────
 * Controls the server would refuse are disabled rather than offered and then
 * rejected — being told "no" after clicking is a worse experience than seeing
 * that it was never available. But every rule is enforced in
 * staff.service.ts, and anyone can call the endpoint directly. Disabling a
 * button is a courtesy; it is never the protection.
 *
 * Two things are shown that most staff lists omit, because they are the
 * questions actually asked: WHY someone cannot sign in (locked, not just
 * inactive), and which row is you.
 */

export function StaffTable() {
  const t = useTranslations('staff');
  const tRole = useTranslations('staffRole');
  const tTable = useTranslations('table');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { user } = useAuth();
  const { tablePageSize } = useAppSettings();

  const [result, setResult] = useState<StaffListResult | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [settingPassword, setSettingPassword] = useState<StaffMember | null>(null);

  const actorRole = (user?.role ?? 'DEMO') as StaffRole;

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(await fetchStaff({ page, pageSize: tablePageSize, ...(search ? { search } : {}) }));
    } catch (caught) {
      setError(translateError(caught));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, search, tablePageSize, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  async function unlock(member: StaffMember) {
    try {
      await unlockStaff(member.id);
      toast.success(t('notice.unlocked', { name: member.name ?? member.email }));
      await load();
    } catch (caught) {
      // A failed unlock is an ACTION outcome, not a load failure — it must
      // not hijack `error`, which DataTable renders as "the table itself
      // couldn't load" and would replace every row with a retry box for a
      // problem that has nothing to do with loading.
      toast.error(
        caught instanceof ApiError && (caught.status === 400 || caught.status === 403)
          ? caught.message
          : translateError(caught),
      );
    }
  }

  const columns: readonly Column<StaffMember>[] = [
    {
      id: 'person',
      header: t('columns.person'),
      cell: (member) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {member.name ?? member.email}
            {member.id === user?.id ? (
              <span className="text-muted-foreground ms-2 text-xs font-normal">
                {t('you')}
              </span>
            ) : null}
          </p>
          {/* force-ltr: an address must not reorder inside an Arabic layout. */}
          <p className="text-muted-foreground force-ltr truncate text-xs">{member.email}</p>
        </div>
      ),
      sortValue: (member) => member.name ?? member.email,
    },
    {
      id: 'role',
      header: t('columns.role'),
      cell: (member) => tRole(member.role),
      sortValue: (member) => member.role,
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (member) => {
        // Locked is NOT the same as deactivated, and conflating them sends an
        // admin to reset a password that was never the problem.
        if (member.lockedUntil) {
          return <Badge variant="destructive">{t('status.locked')}</Badge>;
        }
        return member.isActive ? (
          <Badge variant="secondary">{t('status.active')}</Badge>
        ) : (
          <Badge variant="outline">{t('status.inactive')}</Badge>
        );
      },
      sortValue: (member) => String(member.isActive),
    },
    {
      id: 'lastLogin',
      header: t('columns.lastLogin'),
      cell: (member) =>
        member.lastLoginAt
          ? formatter.dateTime(new Date(member.lastLoginAt), 'short')
          : t('never'),
      sortValue: (member) => (member.lastLoginAt ? new Date(member.lastLoginAt) : null),
    },
    {
      id: '__actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (member) => {
        // Rule 3, mirrored: nobody reaches upward. The server refuses it too.
        const editable = canModify(actorRole, member.role);

        return (
          <div className="flex justify-end gap-1">
            {member.lockedUntil && editable ? (
              <Button
                variant="outline"
                size="sm"
                aria-label={t('actions.unlock', { name: member.name ?? member.email })}
                onClick={() => void unlock(member)}
              >
                <LockOpen aria-hidden />
                {t('actions.unlockShort')}
              </Button>
            ) : null}

            <Button
              variant="ghost"
              size="icon"
              disabled={!editable}
              aria-label={t('actions.password', { name: member.name ?? member.email })}
              onClick={() => setSettingPassword(member)}
            >
              <KeyRound aria-hidden />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              disabled={!editable}
              aria-label={t('actions.edit', { name: member.name ?? member.email })}
              onClick={() => setEditing(member)}
            >
              <Pencil aria-hidden />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor="staff-search">{t('search.label')}</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="staff-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('search.placeholder')}
              className="ps-9"
            />
          </div>
        </div>

        <Button onClick={() => setIsCreating(true)}>
          <Plus aria-hidden />
          {t('actions.create')}
        </Button>
      </div>

      {settingPassword ? (
        <StaffPasswordPanel
          member={settingPassword}
          onDone={(message) => {
            if (message) toast.success(message);
            setSettingPassword(null);
            void load();
          }}
        />
      ) : null}

      <DataTable
        data={result?.staff ?? []}
        columns={columns}
        getRowId={(member) => member.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        emptyMessage={search ? tTable('noResults') : t('empty')}
      />

      {result && result.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm tabular-nums">
            {t('total', { count: result.total })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {t('pagination.previous')}
            </Button>
            <span className="text-sm tabular-nums">
              {tTable('pageOf', { page, total: result.totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= result.totalPages || isLoading}
              onClick={() => setPage((current) => Math.min(result.totalPages, current + 1))}
            >
              {t('pagination.next')}
            </Button>
          </div>
        </div>
      ) : null}

      <StaffSheet
        member={editing}
        actorRole={actorRole}
        actorId={user?.id ?? ''}
        open={isCreating || editing !== null}
        onOpenChange={(next) => {
          if (!next) {
            setIsCreating(false);
            setEditing(null);
          }
        }}
        onSaved={(message) => {
          toast.success(message);
          void load();
        }}
      />
    </div>
  );
}
