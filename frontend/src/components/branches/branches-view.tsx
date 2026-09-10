'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Building2, Pencil, Plus, Store, Users, Warehouse } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { ErrorSection } from '@/components/errors/error-section';
import { BranchSheet } from '@/components/branches/branch-sheet';
import { BranchRosterPanel } from '@/components/branches/branch-roster-panel';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchBusinesses, type BusinessSummary } from '@/lib/branches-api';

/**
 * The org chart: every business, and the shops under it (O7 stage 3).
 *
 * ─── WHY THIS IS GROUPED, NOT A FLAT TABLE ───────────────────────────
 * A branch has no meaning without its business — two businesses may each have
 * a "Main", and `Branch.code` is unique per business precisely because of it.
 * A flat table would need a Business column repeating the same value down
 * every row, which is the shape that made the branch switcher group its
 * options in the first place.
 */

type BranchRow = BusinessSummary['branches'][number];

export function BranchesView() {
  const t = useTranslations('branches.manage');
  const translateError = useTranslatedApiError();

  const [businesses, setBusinesses] = useState<BusinessSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ business: BusinessSummary; branch: BranchRow | null } | null>(
    null,
  );
  const [roster, setRoster] = useState<BranchRow | null>(null);

  const load = useCallback(async () => {
    setError(null);

    try {
      setBusinesses(await fetchBusinesses());
    } catch (caught) {
      setError(translateError(caught));
      setBusinesses(null);
    }
  }, [translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The branch switcher in the topbar loads once on mount, so a branch created
   * or renamed here would not appear in it until a navigation. Reloading is
   * the same blunt, reliable answer the switcher itself already uses when the
   * active branch changes — and for the same reason: a stale switcher showing
   * one branch's name over another branch's data is the exact failure this
   * whole track exists to prevent.
   */
  function savedAndRefresh(message: string) {
    toast.success(message);
    window.location.reload();
  }

  if (error) {
    return <ErrorSection title={t('loadFailed')} description={error} onRetry={() => void load()} />;
  }

  if (businesses === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (businesses.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title={t('emptyTitle')}
        description={t('emptyDescription')}
        action={{ label: t('addBusiness'), href: '/admin/branches/new' }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button asChild>
          <Link href="/admin/branches/new">
            <Plus className="size-4" aria-hidden />
            {t('addBusiness')}
          </Link>
        </Button>
      </div>

      {businesses.map((business) => (
        <section key={business.id} className="rounded-lg border">
          <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
            <Building2 className="text-muted-foreground size-5 shrink-0" aria-hidden />

            <div className="min-w-0 flex-1">
              <h2 className="truncate font-semibold">{business.name}</h2>
              {business.city ? (
                <p className="text-muted-foreground truncate text-sm">{business.city}</p>
              ) : null}
            </div>

            {!business.isActive ? <Badge variant="outline">{t('inactive')}</Badge> : null}

            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/branches/${business.id}`}>
                <Pencil className="size-4" aria-hidden />
                {t('editBusiness')}
              </Link>
            </Button>

            <Button
              size="sm"
              onClick={() => setEditing({ business, branch: null })}
            >
              <Plus className="size-4" aria-hidden />
              {t('addBranch')}
            </Button>
          </header>

          {business.branches.length === 0 ? (
            // A business with no branches cannot record stock or take an
            // order — it is not merely empty, it is unusable until one exists.
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">
              {t('noBranches')}
            </p>
          ) : (
            <ul className="divide-y">
              {business.branches.map((branch) => (
                <li key={branch.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  {branch.isSellingPoint ? (
                    <Store className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  ) : (
                    <Warehouse className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate font-medium">
                      {branch.name}
                      {branch.code ? (
                        <span className="text-muted-foreground text-xs">{branch.code}</span>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground truncate text-sm">
                      {[
                        branch.city,
                        // Says what it IS, not just what flag it carries — a
                        // warehouse holding stock and taking no orders is the
                        // distinction that matters on this page.
                        branch.isSellingPoint ? t('sellingPoint') : t('warehouse'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>

                  {branch.isDefault ? <Badge>{t('default')}</Badge> : null}
                  {!branch.isActive ? <Badge variant="outline">{t('inactive')}</Badge> : null}

                  <Button variant="ghost" size="sm" onClick={() => setRoster(branch)}>
                    <Users className="size-4" aria-hidden />
                    {t('staffCount', { count: branch.staffCount })}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditing({ business, branch })}
                    aria-label={t('editBranchLabel', { name: branch.name })}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {editing ? (
        <BranchSheet
          business={editing.business}
          branch={editing.branch}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSaved={savedAndRefresh}
        />
      ) : null}

      <BranchRosterPanel
        branch={roster}
        open={roster !== null}
        onOpenChange={(open) => {
          if (!open) setRoster(null);
        }}
        onChanged={() => void load()}
      />
    </div>
  );
}
