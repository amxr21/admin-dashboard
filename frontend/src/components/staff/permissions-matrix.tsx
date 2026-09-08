'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { useAppSettings } from '@/components/providers/settings-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/hooks/useAuth';
import {
  fetchRolesModel,
  resetRoleAreas,
  setRoleAreas,
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
        <p className="text-muted-foreground text-sm">{t('description')}</p>
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
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('area')}</TableHead>
                {model.roles.map((role) => (
                  <TableHead key={role.role} className="text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span>{role.label}</span>
                      {role.readOnly ? (
                        <Badge variant="warning" className="text-[10px]">
                          {t('readOnly')}
                        </Badge>
                      ) : null}
                      {/* Locked is a different fact from read-only: DEMO can
                          see everything and write nothing, while OWNER can do
                          everything and cannot be narrowed. */}
                      {role.isLocked ? (
                        <Badge variant="muted" className="text-[10px]">
                          {t('alwaysFull')}
                        </Badge>
                      ) : null}
                      {role.isCustomised && canEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => void reset(role.role)}
                          disabled={savingRole !== null}
                        >
                          <RotateCcw className="size-3" aria-hidden />
                          {t('reset')}
                        </Button>
                      ) : null}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.areas.map((area) => (
                <TableRow key={area}>
                  <TableCell className="font-medium">{areaLabel(area)}</TableCell>
                  {model.roles.map((role) => {
                    const granted = role.areas.includes(area);
                    return (
                      <TableCell key={role.role} className="text-center">
                        {canEdit && !role.isLocked ? (
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
                        ) : granted ? (
                          <Check
                            aria-label={t('granted', { area: areaLabel(area), role: role.label })}
                            className="text-success mx-auto size-4"
                          />
                        ) : (
                          <X
                            aria-label={t('notGranted', { area: areaLabel(area), role: role.label })}
                            className="text-muted-foreground/40 mx-auto size-4"
                          />
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
