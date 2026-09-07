'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { ApiError } from '@/lib/api';
import {
  assignBranchStaff,
  fetchBranchStaff,
  removeBranchStaff,
  type BranchStaffMember,
  type BusinessSummary,
} from '@/lib/branches-api';
import { fetchStaff, STAFF_ROLES, type StaffMember, type StaffRole } from '@/lib/staff-api';

/**
 * Who works at this branch, and in what capacity (O7 stage 2's UI).
 *
 * ─── WHY BOTH ROLES ARE SHOWN ────────────────────────────────────────
 * `role` is what somebody holds HERE; `globalRole` is what they hold
 * everywhere else. F8.4's rule is that the branch role REPLACES the global
 * one, so a person can be SUPPORT across the business and MANAGER at one
 * shop. Showing only the branch role would read as a promotion they do not
 * have; showing only the global one would hide the one that actually applies
 * on this page.
 *
 * ─── OWNER AND DEVELOPER ARE NOT OFFERED ─────────────────────────────
 * They are business-wide: `resolveRoleAtBranch` short-circuits on them before
 * it ever reads the roster. The server refuses them with a 400, and offering
 * them here would invite an owner to make a grant that silently does nothing.
 */

type BranchRow = BusinessSummary['branches'][number];

/** Roles that mean something AT a branch. See the note above. */
const BRANCH_ROLES = STAFF_ROLES.filter((role) => role !== 'OWNER' && role !== 'DEVELOPER');

interface BranchRosterPanelProps {
  branch: BranchRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after any change, so the list behind can refresh its staff counts. */
  onChanged: () => void;
}

export function BranchRosterPanel({
  branch,
  open,
  onOpenChange,
  onChanged,
}: BranchRosterPanelProps) {
  const t = useTranslations('branches.roster');
  const tRoles = useTranslations('roles');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [roster, setRoster] = useState<BranchStaffMember[] | null>(null);
  const [candidates, setCandidates] = useState<StaffMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [pickedUser, setPickedUser] = useState('');
  const [pickedRole, setPickedRole] = useState<StaffRole>('FULFILLMENT');

  const branchId = branch?.id ?? null;

  const load = useCallback(async () => {
    if (!branchId) return;

    setError(null);

    try {
      const [staff, all] = await Promise.all([
        fetchBranchStaff(branchId),
        // The whole roster fits one page in every install this targets; a
        // branch with more than 100 staff needs a search box, not a taller
        // dropdown, and that is a different piece of work.
        fetchStaff({ pageSize: 100 }),
      ]);

      setRoster(staff);
      setCandidates(all.staff.filter((member) => member.isActive));
    } catch (caught) {
      setError(translateError(caught));
      setRoster([]);
    }
  }, [branchId, translateError]);

  useEffect(() => {
    if (!open) return;
    setRoster(null);
    setPickedUser('');
    void load();
  }, [open, load]);

  async function assign() {
    if (!branchId || !pickedUser) return;

    setIsSaving(true);
    setError(null);

    try {
      await assignBranchStaff(branchId, pickedUser, pickedRole);
      toast.success(t('assigned'));
      setPickedUser('');
      await load();
      onChanged();
    } catch (caught) {
      // The server's 400/403 explains WHICH rule refused (own role, above your
      // rank, outranks you, business-wide role) — far better than a generic
      // failure, so it is surfaced verbatim.
      setError(
        caught instanceof ApiError && (caught.status === 400 || caught.status === 403)
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(userId: string) {
    if (!branchId) return;

    setIsSaving(true);
    setError(null);

    try {
      await removeBranchStaff(branchId, userId);
      toast.success(t('removed'));
      await load();
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 403
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSaving(false);
    }
  }

  // Somebody already on the roster is not offered again — re-assigning is done
  // by changing their row, not by adding them twice (the API upserts either
  // way, but a duplicate entry in the picker reads like it would create one).
  const assignable = candidates.filter(
    (member) => !(roster ?? []).some((row) => row.userId === member.id),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="max-w-lg overflow-y-auto"
        title={t('title', { name: branch?.name ?? '' })}
      >
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">{t('title', { name: branch?.name ?? '' })}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
          </div>

          {error ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          <div className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-medium">{t('addTitle')}</h3>

            <div className="space-y-2">
              <Label htmlFor="roster-person">{t('person')}</Label>
              <Select value={pickedUser} onValueChange={setPickedUser}>
                <SelectTrigger id="roster-person">
                  <SelectValue placeholder={t('choosePerson')} />
                </SelectTrigger>
                <SelectContent>
                  {assignable.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name ?? member.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="roster-role">{t('roleHere')}</Label>
              <Select
                value={pickedRole}
                onValueChange={(value) => setPickedRole(value as StaffRole)}
              >
                <SelectTrigger id="roster-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BRANCH_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {tRoles(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{t('roleHint')}</p>
            </div>

            <Button
              onClick={() => void assign()}
              disabled={!pickedUser || isSaving}
              className="w-full"
            >
              <UserPlus className="size-4" aria-hidden />
              {t('add')}
            </Button>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t('currentTitle')}</h3>

            {roster === null ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : roster.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
                {t('empty')}
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {roster.map((row) => (
                  <li key={row.userId} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name ?? row.email}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {/* Both roles, per the note at the top of this file. */}
                        {t('rolePair', {
                          here: tRoles(row.role as StaffRole),
                          global: tRoles(row.globalRole as StaffRole),
                        })}
                      </p>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void remove(row.userId)}
                      disabled={isSaving}
                      aria-label={t('removeLabel', { name: row.name ?? row.email })}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
