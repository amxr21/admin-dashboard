'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  History,
  KeyRound,
  LockOpen,
  Pencil,
  Plus,
  Search,
  Ticket,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';

import { DataTable, type Column } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { InviteStaffSheet } from '@/components/staff/invite-staff-sheet';
import { StaffSheet } from '@/components/staff/staff-sheet';
import { StaffPasswordPanel } from '@/components/staff/staff-password-panel';
import { ResetTokenPanel } from '@/components/staff/reset-token-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import { FilterChips, type AppliedFilter } from '@/components/filter-chips';
import { Timestamp } from '@/components/timestamp';
import { RowActions, type RowAction } from '@/components/row-actions';
import { TablePagination } from '@/components/table-pagination';
import { DensityToggle } from '@/components/density-toggle';
import { getGlobalDensity } from '@/lib/apply-appearance';
import { useTableDensity } from '@/hooks/useTableDensity';
import { useAppSettings } from '@/components/providers/settings-provider';
import {
  canModify,
  fetchStaff,
  issueStaffResetToken,
  unlockStaff,
  type ResetTokenResult,
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

const ALL = 'all';

/** Defaults are omitted from the URL, so an unfiltered list has a clean one. */
const URL_DEFAULTS = { page: '1', search: '', role: ALL, status: ALL, pageSize: '' };

const ROLE_OPTIONS: readonly StaffRole[] = [
  'DEVELOPER',
  'OWNER',
  'MANAGER',
  'FULFILLMENT',
  'SUPPORT',
  'DEMO',
];

/** A hand-edited `?role=WIZARD` must fall back to "all" rather than reach the
 * API as a 400 the user can do nothing about. */
function toRole(value: string): StaffRole | null {
  return (ROLE_OPTIONS as readonly string[]).includes(value) ? (value as StaffRole) : null;
}

export function StaffTable() {
  const t = useTranslations('staff');
  const tRole = useTranslations('staffRole');
  const tTable = useTranslations('table');
  const tAudit = useTranslations('audit');
  const translateError = useTranslatedApiError();
  const { user } = useAuth();
  const { tablePageSize } = useAppSettings();

  /** Per-table density override — see resource-table.tsx / useTableDensity.ts. */
  const { override: densityOverride, setOverride: setDensityOverride } =
    useTableDensity('staff');

  const [result, setResult] = useState<StaffListResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /** Page and search live in the URL so a filtered view is shareable. */
  const { values, setValues } = useUrlState(URL_DEFAULTS);

  const page = Math.max(1, Number(values.page) || 1);

  /** Overrides `dashboard.tablePageSize` for this view only — see resource-table.tsx. */
  const urlPageSize = Number(values.pageSize);
  const effectivePageSize =
    Number.isFinite(urlPageSize) && urlPageSize > 0 ? urlPageSize : tablePageSize;
  const search = values.search ?? '';
  const role = values.role ?? ALL;
  const status = values.status ?? ALL;
  const hasFilters = Boolean(search) || Boolean(toRole(role)) || status !== ALL;

  // Holds raw keystrokes; only the debounced value reaches the URL.
  const [searchInput, setSearchInput] = useState(search);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [settingPassword, setSettingPassword] = useState<StaffMember | null>(null);
  // Held only until the reveal is dismissed — never persisted, never re-fetchable.
  const [issuedToken, setIssuedToken] = useState<ResetTokenResult | null>(null);
  const [issuingFor, setIssuingFor] = useState<string | null>(null);

  const actorRole = (user?.role ?? 'DEMO') as StaffRole;

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(
        await fetchStaff({
          page,
          pageSize: effectivePageSize,
          ...(search ? { search } : {}),
          ...(toRole(role) ? { role: toRole(role) as StaffRole } : {}),
          // Tri-state: "all" sends nothing, so the API's own default (both)
          // stays the default rather than being re-implemented here.
          ...(status === 'active'
            ? { isActive: true }
            : status === 'inactive'
              ? { isActive: false }
              : {}),
        }),
      );
    } catch (caught) {
      setError(translateError(caught));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, search, role, status, effectivePageSize, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Debounced so typing doesn't fire a request — or a navigation — per
   * keystroke. The equality guard prevents a redundant write on mount, where
   * the effect would otherwise push back the same value it just read.
   */
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;

    const timer = setTimeout(() => {
      setValues({ search: trimmed, page: null });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, search, setValues]);

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

  /**
   * Issue a one-time reset token and reveal it.
   *
   * No `load()` afterwards on purpose: issuing a token changes nothing visible
   * on the row (the account is not locked, disabled, or otherwise altered
   * until the token is actually redeemed), so refetching would only cost a
   * request and flicker the table under the open dialog.
   */
  async function issueToken(member: StaffMember) {
    setIssuingFor(member.id);

    try {
      setIssuedToken(await issueStaffResetToken(member.id));
    } catch (caught) {
      // Same rule as `unlock`: an action failure is a toast, never `error`.
      toast.error(
        caught instanceof ApiError && (caught.status === 400 || caught.status === 403)
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIssuingFor(null);
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
        member.lastLoginAt ? <Timestamp value={member.lastLoginAt} /> : t('never'),
      sortValue: (member) => (member.lastLoginAt ? new Date(member.lastLoginAt) : null),
    },
    {
      id: 'accessExpiresAt',
      header: t('columns.accessExpiresAt'),
      cell: (member) => {
        // Blank when unset — no expiry is the common case and deserves no
        // visual weight, same treatment as `lastLogin`'s "Never".
        if (!member.accessExpiresAt) return null;

        const expired = new Date(member.accessExpiresAt) < new Date();

        return (
          <span className={expired ? 'text-destructive font-medium' : undefined}>
            <Timestamp value={member.accessExpiresAt} />
            {/* This is silently blocking their login right now — the field
                controls access whether or not anyone is looking at it, so an
                expired-but-unnoticed row is worth calling out rather than
                rendering identically to a future date. */}
            {expired ? ` (${t('status.expired')})` : ''}
          </span>
        );
      },
      sortValue: (member) =>
        member.accessExpiresAt ? new Date(member.accessExpiresAt) : null,
    },
    {
      id: '__actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (member) => {
        // Rule 3, mirrored: nobody reaches upward. The server refuses it too.
        const editable = canModify(actorRole, member.role);
        const name = member.name ?? member.email;

        // Edit and password reset are the two reached for most; token issue
        // and history fold into the overflow. History is NOT gated by
        // `editable` — reading what someone did is not the same permission
        // as changing what they can do, and this page is already
        // staff-area-gated, so anyone here already has audit access (see
        // audit.route.ts).
        const rowActions: RowAction[] = [
          {
            id: 'edit',
            label: t('actions.edit', { name }),
            icon: Pencil,
            disabled: !editable,
            onClick: () => setEditing(member),
          },
          {
            id: 'password',
            label: t('actions.password', { name }),
            icon: KeyRound,
            disabled: !editable,
            onClick: () => setSettingPassword(member),
          },
          {
            id: 'reset-token',
            label: t('actions.resetToken', { name }),
            icon: Ticket,
            disabled: !editable || issuingFor === member.id,
            onClick: () => void issueToken(member),
          },
          {
            id: 'history',
            label: tAudit('viewHistory'),
            icon: History,
            href: `/admin/audit?actorId=${member.id}`,
          },
        ];

        return (
          <div className="flex justify-end gap-1">
            {member.lockedUntil && editable ? (
              <Button
                variant="outline"
                size="sm"
                aria-label={t('actions.unlock', { name })}
                onClick={() => void unlock(member)}
              >
                <LockOpen aria-hidden />
                {t('actions.unlockShort')}
              </Button>
            ) : null}

            <RowActions actions={rowActions} />
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

        <div className="w-44 space-y-2">
          <Label htmlFor="staff-filter-role">{t('filters.role')}</Label>
          <Select
            value={role}
            onValueChange={(value) =>
              setValues({ role: value === ALL ? null : value, page: null })
            }
          >
            <SelectTrigger id="staff-filter-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filters.all')}</SelectItem>
              {ROLE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {tRole(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-44 space-y-2">
          <Label htmlFor="staff-filter-status">{t('filters.status')}</Label>
          <Select
            value={status}
            onValueChange={(value) =>
              setValues({ status: value === ALL ? null : value, page: null })
            }
          >
            <SelectTrigger id="staff-filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filters.all')}</SelectItem>
              <SelectItem value="active">{t('filters.active')}</SelectItem>
              <SelectItem value="inactive">{t('filters.inactive')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Invite is the PRIMARY action — the spec names it as such for this
            page, and it is now the recommended path: the admin never learns
            the new person's password. "Create with a password" stays
            available (outline, secondary) for the case an invite can't
            reach them — no email configured yet, say. */}
        <Button variant="outline" onClick={() => setIsCreating(true)}>
          <Plus aria-hidden />
          {t('actions.create')}
        </Button>
        <Button onClick={() => setIsInviting(true)}>
          <UserPlus aria-hidden />
          {t('actions.invite')}
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

      {issuedToken ? (
        <ResetTokenPanel
          staffEmail={issuedToken.staff.email}
          token={issuedToken.token}
          expiresAt={issuedToken.expiresAt}
          // Dropping the token from state is what makes the reveal one-time:
          // there is no way back to it, matching the server, which kept only a
          // hash.
          onDone={() => setIssuedToken(null)}
        />
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <FilterChips
          filters={
            [
              search
                ? {
                    id: 'search',
                    label: `${t('search.label')}: ${search}`,
                    onRemove: () => {
                      setSearchInput('');
                      setValues({ search: null, page: null });
                    },
                  }
                : null,
              toRole(role)
                ? {
                    id: 'role',
                    label: `${t('filters.role')}: ${tRole(role)}`,
                    onRemove: () => setValues({ role: null, page: null }),
                  }
                : null,
              status === 'active' || status === 'inactive'
                ? {
                    id: 'status',
                    label: `${t('filters.status')}: ${t(`filters.${status}`)}`,
                    onRemove: () => setValues({ status: null, page: null }),
                  }
                : null,
            ].filter(Boolean) as AppliedFilter[]
          }
        />
        <DensityToggle
          value={densityOverride ?? getGlobalDensity()}
          onChange={setDensityOverride}
          className="ms-auto shrink-0"
        />
      </div>

      <DataTable
        data={result?.staff ?? []}
        columns={columns}
        getRowId={(member) => member.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        density={densityOverride ?? undefined}
        emptyMessage={
          // Filtered-empty and first-run-empty are different facts. Offering
          // "create the first staff member" to someone who simply filtered to
          // a role nobody holds is wrong — and there is always at least one
          // account, since someone is reading this page.
          hasFilters ? (
            tTable('noResults')
          ) : (
            <EmptyState
              title={t('empty')}
              action={{ label: t('actions.create'), onClick: () => setIsCreating(true) }}
            />
          )
        }
      />

      {result ? (
        <TablePagination
          page={page}
          totalPages={result.totalPages}
          total={result.total}
          pageSize={effectivePageSize}
          isLoading={isLoading}
          onPageChange={(next) => setValues({ page: String(next) })}
          onPageSizeChange={(next) => setValues({ pageSize: String(next), page: null })}
          totalLabel={t('total', { count: result.total })}
        />
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

      <InviteStaffSheet
        actorRole={actorRole}
        open={isInviting}
        onOpenChange={setIsInviting}
        onInvited={() => void load()}
      />
    </div>
  );
}
