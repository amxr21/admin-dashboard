'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Store, Warehouse } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchBranches, type BranchSummary } from '@/lib/branches-api';
import { readBranchId, writeBranchId } from '@/lib/auth-storage';

/**
 * Which shop am I standing in (F8.5).
 *
 * ─── WHY CHANGING IT RELOADS THE PAGE ────────────────────────────────
 * The branch changes what nearly every query returns AND what the caller may
 * do (F8.4 resolves authorisation from it). Every list, report, count and the
 * sidebar itself would have to re-fetch, and each one that did not would keep
 * showing another branch's data under the new branch's name — the exact
 * failure this whole track exists to prevent, reintroduced in the UI.
 *
 * A reload is blunt and completely reliable. Refetching everything correctly
 * is a larger change (a query cache with a scope key) and belongs with one, if
 * the reload ever proves annoying enough to justify it.
 *
 * ─── "ALL BRANCHES" IS A REAL CHOICE, NOT AN EMPTY STATE ─────────────
 * It is how an owner asks "how is the business doing", and the unscoped
 * reports answer exactly that. It is the default until someone picks
 * otherwise — never auto-selected to the first branch, which would silently
 * narrow every number an owner sees on their first visit.
 */
export function BranchSwitcher() {
  const t = useTranslations('branches');
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    setActive(readBranchId());

    // A failure here is not worth an error state: the switcher simply does not
    // appear, and everything keeps working unscoped, which is what an install
    // with no branches does anyway.
    void fetchBranches()
      .then(setBranches)
      .catch(() => setBranches([]));
  }, []);

  // Nothing to switch between — a single-branch install should not carry a
  // control that can only ever have one answer.
  if (branches.length < 2) return null;

  function choose(value: string) {
    const next = value === 'all' ? null : value;
    writeBranchId(next);
    setActive(next);
    // See the note above: a reload, deliberately.
    window.location.reload();
  }

  // Grouped by business, because two businesses may each have a "Main" and the
  // branch name alone would be ambiguous at the moment of choosing.
  const byBusiness = new Map<string, BranchSummary[]>();
  for (const branch of branches) {
    const list = byBusiness.get(branch.businessName) ?? [];
    list.push(branch);
    byBusiness.set(branch.businessName, list);
  }

  const activeBranch = branches.find((branch) => branch.id === active);

  return (
    <Select value={active ?? 'all'} onValueChange={choose}>
      <SelectTrigger
        className="h-8 w-full max-w-56 text-sm"
        aria-label={t('switcherLabel')}
      >
        <SelectValue>
          <span className="flex items-center gap-2 truncate">
            {activeBranch && !activeBranch.isSellingPoint ? (
              <Warehouse className="size-4 shrink-0" aria-hidden />
            ) : (
              <Store className="size-4 shrink-0" aria-hidden />
            )}
            <span className="truncate">{activeBranch?.name ?? t('allBranches')}</span>
          </span>
        </SelectValue>
      </SelectTrigger>

      <SelectContent>
        <SelectItem value="all">{t('allBranches')}</SelectItem>

        {[...byBusiness.entries()].map(([business, list]) => (
          <SelectGroup key={business}>
            <SelectLabel>{business}</SelectLabel>
            {list.map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                <span className="flex items-center gap-2">
                  {branch.isSellingPoint ? (
                    <Store className="size-4 shrink-0" aria-hidden />
                  ) : (
                    <Warehouse className="size-4 shrink-0" aria-hidden />
                  )}
                  <span>{branch.name}</span>
                  {/* The code disambiguates two branches with the same name in
                      different cities, which is common enough to matter. */}
                  {branch.code ? (
                    <span className="text-muted-foreground text-xs">{branch.code}</span>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
