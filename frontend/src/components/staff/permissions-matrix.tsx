'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { useAppSettings } from '@/components/providers/settings-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchRolesModel, type RolesModel } from '@/lib/roles-api';

/**
 * Permissions matrix — resource (area) × role, read from the LIVE model.
 *
 * ─── SCOPED AS READ-ONLY, DELIBERATELY (B2.7) ─────────────────────────
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

  const [model, setModel] = useState<RolesModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section aria-labelledby="staff-permissions-title" className="space-y-4">
      <div className="space-y-1">
        <h2 id="staff-permissions-title" className="text-lg font-semibold tracking-tight">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

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
                        {granted ? (
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
