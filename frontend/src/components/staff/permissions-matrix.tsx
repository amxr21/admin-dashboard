'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Lock, Minus, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { useAppSettings } from '@/components/providers/settings-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_PERMISSIONS_CHANGED } from '@/components/providers/role-permissions-provider';
import { cn } from '@/lib/utils';
import {
  fetchRolesModel,
  resetRoleAreas,
  setRoleAreas,
  type RoleGrant,
  type RolesModel,
} from '@/lib/roles-api';
import type { Area, StaffRole } from '@/config/areas';

/**
 * Permissions matrix — resource (area) × role, read from the LIVE model.
 *
 * ─── EDITABLE SINCE O8 (2026-09-08) ───────────────────────────────────
 * The owner asked to be able to change what each role reaches, so the grid is
 * now the control rather than a report of one. What is edited is the AREA SET
 * per role; the roles themselves are still the fixed enum — see the note
 * below, which still stands for custom roles.
 *
 * OWNER and DEVELOPER render locked. They always keep full access, because an
 * owner who unticked their own `settings` box would lose the very screen that
 * ticks it back. The API refuses them too, so this is not a UI convention.
 *
 * ─── WHY LOCKED ROLES ARE NOT COLUMNS (2026-09-14 redesign) ───────────
 * They were, and they cost a third of the table's width to say one unchanging
 * thing thirteen times. A column exists to be COMPARED down its length; a
 * column whose every cell is identical by definition carries no information
 * per row, only per column — so it is stated once, above the grid, and the
 * width goes to the five roles an owner actually has to reason about.
 *
 * ─── WHY AREAS ARE GROUPED ────────────────────────────────────────────
 * Thirteen flat rows is a list you scan linearly. The same thirteen under four
 * headings is a structure you navigate, and the headings carry the real
 * question an owner is asking ("can this role touch MONEY?"). The groups are
 * presentation only — `model.areas` from the server stays the authority for
 * WHICH areas exist, and any area a future release adds that this file does
 * not classify still renders, under "other". A missing area would otherwise be
 * invisible: the worst possible failure for a permissions screen.
 *
 * ─── CUSTOM ROLES ARE STILL OUT OF SCOPE (B2.7) ───────────────────────
 * The fuller spec asks for custom roles, cloning, and a preview alongside
 * this matrix. Those need `StaffRole` to stop being a fixed 6-value Prisma
 * enum and become data — a role a business defines, not one this codebase
 * ships with. That is a schema-and-architecture decision on the scale of the
 * `Session` model (B2.6) or the Track D items, touching every authorization
 * check in the app (`canAccessArea`, `rankOf`, `outranks`, the JWT's `role`
 * claim, `User.role`'s column type itself) — not a UI task. Flagged, not
 * built, same treatment as B3.9.
 *
 * A "preview as this role" ALREADY EXISTS, separately — see
 * `view-as-banner.tsx`/`view-as-switcher.tsx` in the shell, shipped an
 * earlier session. This matrix is the missing READ surface for the model
 * that feature already previews.
 *
 * ─── WHY THIS READS `GET /roles` INSTEAD OF `config/areas.ts` ─────────
 * See `roles-api.ts`'s own doc comment: the sidebar's copy is advisory and
 * explicitly allowed to drift (it can only under- or mis-label a menu, never
 * over-grant). A screen whose entire purpose is "what can this role actually
 * do" needs to be the one place that is NEVER stale — so it fetches live.
 */

/**
 * Presentation grouping for the area rows.
 *
 * Deliberately NOT the source of which areas exist — see the doc comment
 * above. `groupAreas()` below classifies whatever the server sends and sweeps
 * anything unrecognised into a trailing "other" group, so adding an area
 * backend-side can never make it silently vanish from this screen.
 */
const AREA_GROUPS = [
  { id: 'selling', areas: ['orders', 'products', 'discounts'] },
  { id: 'fulfilment', areas: ['inventory', 'delivery', 'returns', 'shifts'] },
  { id: 'catalogue', areas: ['categories', 'reviews', 'customers'] },
  { id: 'oversight', areas: ['reports', 'settings', 'staff'] },
] as const satisfies readonly { id: string; areas: readonly string[] }[];

type GroupId = (typeof AREA_GROUPS)[number]['id'] | 'other';

function groupAreas(areas: readonly Area[]): { id: GroupId; areas: Area[] }[] {
  const classified = new Set<string>();

  const groups = AREA_GROUPS.map((group) => {
    // Intersect in the GROUP's order, not the server's: the grouping exists to
    // impose a deliberate reading order, and taking the server's order here
    // would make the rows shuffle whenever `AREAS` is reordered upstream.
    const present = group.areas.filter((area) => areas.includes(area as Area)) as Area[];
    present.forEach((area) => classified.add(area));
    return { id: group.id as GroupId, areas: present };
  }).filter((group) => group.areas.length > 0);

  const unclassified = areas.filter((area) => !classified.has(area));

  return unclassified.length > 0
    ? [...groups, { id: 'other' as GroupId, areas: [...unclassified] }]
    : groups;
}

export function PermissionsMatrix() {
  const t = useTranslations('staff.permissions');
  const tNav = useTranslations('nav');
  const { navLabels } = useAppSettings();
  const translateError = useTranslatedApiError();

  // Same override-then-fallback the sidebar uses — `area` here can be any
  // Area string, most of which (settings, audit, ...) have no override.
  const areaLabel = (area: string) => navLabels[area] ?? tNav(area);

  const { user } = useAuth();
  const [model, setModel] = useState<RolesModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<StaffRole | null>(null);
  /**
   * A failed SAVE is not a failed LOAD.
   *
   * `error` replaces the whole table, which is right when the model could not
   * be fetched — there is nothing to show. It is wrong for a rejected toggle:
   * the grid is still valid (it has been rolled back), and wiping it leaves
   * the owner with no idea what the permissions now are.
   */
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * Which cell the pointer is over, so the whole row AND column can tint.
   *
   * At 13 rows × 5 columns of near-identical checkboxes, "which one am I about
   * to click" is a real question — the crosshair answers it. Pointer-only by
   * design: keyboard users get the focus ring, which is already unambiguous,
   * and driving this from focus too would fight the ring rather than add to it.
   */
  const [hovered, setHovered] = useState<{ area: Area; role: StaffRole } | null>(null);

  /**
   * Only an owner or developer may edit — the same pair the API enforces.
   *
   * Hiding the controls from everyone else is a courtesy, not the control:
   * a MANAGER who forged the request would still be refused. But showing
   * checkboxes that always fail is worse than showing none.
   */
  const canEdit = user?.role === 'OWNER' || user?.role === 'DEVELOPER';

  useEffect(() => {
    let cancelled = false;

    fetchRolesModel()
      .then((result) => {
        if (!cancelled) setModel(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(translateError(caught));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Deliberately fetch-once-on-mount: `translateError` only changes if the
    // locale itself changes (it's a useCallback keyed on next-intl's `t`),
    // and re-fetching the permission model on a language switch — which
    // hasn't changed what any role can do — would be a pointless request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Locked roles are stated once above the grid; the rest become columns.
   *
   * Split from `model` rather than filtered at each of the three places that
   * iterate roles, so the header, the body and the footer can never disagree
   * about which roles are columns.
   */
  const { lockedRoles, editableRoles, groups } = useMemo(() => {
    if (!model) {
      return {
        lockedRoles: [] as RoleGrant[],
        editableRoles: [] as RoleGrant[],
        groups: [] as { id: GroupId; areas: Area[] }[],
      };
    }

    return {
      lockedRoles: model.roles.filter((role) => role.isLocked),
      editableRoles: model.roles.filter((role) => !role.isLocked),
      groups: groupAreas(model.areas),
    };
  }, [model]);

  /**
   * Sends the intended FINAL set, not a diff.
   *
   * The grid is checkboxes over a set the server owns, so a diff computed
   * against a page that has gone stale would remove an area nobody touched.
   * The row is updated optimistically and rolled back on failure, because a
   * checkbox that does not move until a round trip completes feels broken.
   */
  async function toggle(role: StaffRole, area: Area, granted: boolean) {
    if (!model || savingRole !== null) return;

    const current = model.roles.find((entry) => entry.role === role);
    if (!current || current.isLocked) return;

    const next = granted
      ? [...current.areas, area]
      : current.areas.filter((value) => value !== area);

    await commit(role, next);
  }

  /**
   * Grant or revoke a whole column at once.
   *
   * The same optimistic-then-roll-back path as a single toggle, and the same
   * whole-set PUT — thirteen sequential single-area requests would leave a
   * half-applied role on any failure, which is precisely the state this screen
   * exists to make legible.
   */
  async function setWholeRole(role: StaffRole, granted: boolean) {
    if (!model || savingRole !== null) return;

    const current = model.roles.find((entry) => entry.role === role);
    if (!current || current.isLocked) return;

    await commit(role, granted ? [...model.areas] : []);
  }

  /** The shared optimistic write both entry points above go through. */
  async function commit(role: StaffRole, next: Area[]) {
    if (!model) return;

    const previous = model;

    setModel({
      ...model,
      roles: model.roles.map((entry) =>
        entry.role === role ? { ...entry, areas: next, isCustomised: true } : entry,
      ),
    });
    setSavingRole(role);
    setSaveError(null);

    try {
      await setRoleAreas(role, next);
      window.dispatchEvent(new Event(ROLE_PERMISSIONS_CHANGED));
    } catch (caught) {
      // Put the grid back to what the server still believes, so the screen
      // never shows a permission that was not saved.
      setModel(previous);
      setSaveError(translateError(caught));
    } finally {
      setSavingRole(null);
    }
  }

  /**
   * Return a role to the shipped default.
   *
   * A real action rather than "tick everything back by hand": the defaults
   * change between releases, and a manual reset would freeze the role at
   * whatever this version happens to grant.
   */
  async function reset(role: StaffRole) {
    if (!model || savingRole !== null) return;

    setSavingRole(role);
    setSaveError(null);

    try {
      const updated = await resetRoleAreas(role);

      setModel({
        ...model,
        roles: model.roles.map((entry) =>
          entry.role === role
            ? { ...entry, areas: updated.areas, isCustomised: false }
            : entry,
        ),
      });
      toast.success(t('resetDone'));
      window.dispatchEvent(new Event(ROLE_PERMISSIONS_CHANGED));
    } catch (caught) {
      setSaveError(translateError(caught));
    } finally {
      setSavingRole(null);
    }
  }

  return (
    <section aria-labelledby="staff-permissions-title" className="space-y-4">
      <div className="space-y-1">
        <h2 id="staff-permissions-title" className="text-lg font-semibold tracking-tight">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm">
          {canEdit ? t('descriptionEditable') : t('description')}
        </p>
      </div>

      {saveError ? (
        // Above the grid, not instead of it: the rolled-back table is still
        // the truth and the owner needs to see it.
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {saveError}
        </p>
      ) : null}

      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : isLoading || !model ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="bg-card overflow-hidden rounded-lg border">
          {/*
            The locked roles, stated once. This is the width that used to go on
            two columns of unchanging green ticks — see the doc comment.
          */}
          {lockedRoles.length > 0 ? (
            <div className="bg-muted/40 flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2.5">
              <ShieldCheck className="text-success size-4 shrink-0" aria-hidden />
              <span className="text-sm font-medium">
                {lockedRoles.map((role) => role.label).join(' · ')}
              </span>
              <span className="text-muted-foreground text-sm">{t('alwaysFullExplained')}</span>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {/*
                    Sticky so the area name stays readable while the role
                    columns scroll on a narrow screen — without it, a horizontal
                    scroll leaves you looking at a row of checkboxes with no
                    idea which permission they belong to. `bg-card` is required:
                    a transparent sticky cell lets the scrolled content slide
                    visibly underneath it.
                  */}
                  <TableHead className="bg-card sticky start-0 z-10 min-w-44">
                    {t('area')}
                  </TableHead>

                  {editableRoles.map((role) => {
                    const count = role.areas.length;

                    return (
                      <TableHead
                        key={role.role}
                        className={cn(
                          'min-w-28 text-center transition-colors',
                          hovered?.role === role.role && 'bg-muted/50',
                        )}
                      >
                        <div className="flex flex-col items-center gap-1 py-0.5">
                          <span className="text-foreground font-medium">{role.label}</span>

                          {/*
                            The column question — "how much can this role
                            reach?" — answered directly instead of by counting
                            thirteen ticks.
                          */}
                          <span className="text-muted-foreground text-xs font-normal tabular-nums">
                            {t('coverage', { count, total: model.areas.length })}
                          </span>

                          <div className="flex flex-wrap items-center justify-center gap-1">
                            {role.readOnly ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="warning" className="cursor-help text-[10px]">
                                    {t('readOnly')}
                                  </Badge>
                                </TooltipTrigger>
                                {/* The distinction a bare grid hides: DEMO
                                    reaches these areas and can write to none
                                    of them. */}
                                <TooltipContent>{t('readOnlyExplained')}</TooltipContent>
                              </Tooltip>
                            ) : null}

                            {role.isCustomised ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="info" className="cursor-help text-[10px]">
                                    {t('customised')}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>{t('customisedExplained')}</TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>

                          {canEdit ? (
                            <div className="flex items-center gap-0.5">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-1.5 text-[10px] font-normal"
                                    onClick={() => void setWholeRole(role.role, true)}
                                    disabled={savingRole !== null || count === model.areas.length}
                                    aria-label={t('grantAll', { role: role.label })}
                                  >
                                    <Check className="size-3" aria-hidden />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t('grantAll', { role: role.label })}</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-1.5 text-[10px] font-normal"
                                    onClick={() => void setWholeRole(role.role, false)}
                                    disabled={savingRole !== null || count === 0}
                                    aria-label={t('revokeAll', { role: role.label })}
                                  >
                                    <Minus className="size-3" aria-hidden />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t('revokeAll', { role: role.label })}</TooltipContent>
                              </Tooltip>

                              {role.isCustomised ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-1.5 text-[10px] font-normal"
                                      onClick={() => void reset(role.role)}
                                      disabled={savingRole !== null}
                                      aria-label={t('resetRole', { role: role.label })}
                                    >
                                      <RotateCcw className="size-3" aria-hidden />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{t('resetRole', { role: role.label })}</TooltipContent>
                                </Tooltip>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>

              <TableBody>
                {groups.map((group) => (
                  // Fragment keyed by group: the rows must stay SIBLINGS inside
                  // one <tbody>, since wrapping each group in its own tbody or
                  // table would let the column widths drift apart between
                  // groups — the one thing a matrix cannot afford.
                  <Fragment key={group.id}>
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={editableRoles.length + 1}
                        className="bg-muted/30 py-1.5"
                      >
                        <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                          {t(`groups.${group.id}`)}
                        </span>
                      </TableCell>
                    </TableRow>

                    {group.areas.map((area) => {
                      // A row nobody holds is a real, deliberate configuration
                      // (Staff is owner-only by design) — but rendered as
                      // thirteen blank cells it is indistinguishable from a
                      // failed load. It gets said out loud instead.
                      const holders = editableRoles.filter((role) =>
                        role.areas.includes(area),
                      ).length;

                      return (
                        <TableRow
                          key={area}
                          className={cn(hovered?.area === area && 'bg-muted/50')}
                        >
                          <TableCell
                            className={cn(
                              'bg-card sticky start-0 z-10 font-medium transition-colors',
                              hovered?.area === area && 'bg-muted/50',
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span>{areaLabel(area)}</span>

                              {holders === 0 ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-muted-foreground inline-flex cursor-help items-center gap-1 text-xs font-normal">
                                      <Lock className="size-3" aria-hidden />
                                      {t('ownerOnly')}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {t('ownerOnlyExplained', { area: areaLabel(area) })}
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                            </div>
                          </TableCell>

                          {editableRoles.map((role) => {
                            const granted = role.areas.includes(area);

                            return (
                              <TableCell
                                key={role.role}
                                className={cn(
                                  'text-center transition-colors',
                                  hovered?.role === role.role && 'bg-muted/50',
                                )}
                                onPointerEnter={() => setHovered({ area, role: role.role })}
                                onPointerLeave={() =>
                                  setHovered((current) =>
                                    current?.area === area && current.role === role.role
                                      ? null
                                      : current,
                                  )
                                }
                              >
                                {canEdit ? (
                                  // A bare checkbox is a 16px target in a 13×5
                                  // grid. The label wraps it in the whole cell,
                                  // so the clickable area is the cell — without
                                  // changing what the checkbox itself reports.
                                  <label className="flex cursor-pointer items-center justify-center py-1">
                                    <Checkbox
                                      checked={granted}
                                      onCheckedChange={(checked) =>
                                        void toggle(role.role, area, checked === true)
                                      }
                                      disabled={savingRole !== null}
                                      aria-label={t('toggle', {
                                        area: areaLabel(area),
                                        role: role.label,
                                      })}
                                    />
                                  </label>
                                ) : granted ? (
                                  <Check
                                    aria-label={t('granted', {
                                      area: areaLabel(area),
                                      role: role.label,
                                    })}
                                    className="text-success mx-auto size-4"
                                  />
                                ) : (
                                  <X
                                    aria-label={t('notGranted', {
                                      area: areaLabel(area),
                                      role: role.label,
                                    })}
                                    className="text-muted-foreground/40 mx-auto size-4"
                                  />
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </section>
  );
}
