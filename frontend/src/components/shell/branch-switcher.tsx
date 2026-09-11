'use client';

import { useEffect, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Loader2, Store, Warehouse } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
  const [isSwitching, setIsSwitching] = useState(false);

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
    if (isSwitching || next === active) return;
    flushSync(() => setIsSwitching(true));
    writeBranchId(next);
    setActive(next);
    // Give the overlay a paint before the full reload replaces the document.
    requestAnimationFrame(() => requestAnimationFrame(() => window.location.reload()));
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
    <>
    {isSwitching ? createPortal(
      <div className="bg-background/90 fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
        {/*
          Same compact row as the global overlay, for one consistent "something
          is happening" shape across the shell — not the shared `LoadingState`,
          whose `min-h-48` column is built for a panel filling a page.

          Unlike the global overlay this label is a full sentence explaining
          that the workspace is being rebuilt, so it WRAPS rather than
          truncating: the explanation is the entire reason this overlay exists
          (a branch switch reloads the document), and a clipped sentence would
          defeat it.
        */}
        <div
          role="status"
          className="bg-card flex max-w-sm items-center gap-3 rounded-2xl border px-5 py-4 shadow-lg"
        >
          <Loader2
            aria-hidden
            className="text-primary size-4 shrink-0 animate-spin motion-reduce:animate-none"
          />
          <span className="text-sm font-medium">{t('switching')}</span>
        </div>
      </div>, document.body,
    ) : null}
    {/*
      URG-014 — was a flat `max-w-56` (224px) regardless of content, so a
      longer branch name (a business prefix, a real name, a disambiguating
      code) cropped well before it needed to. `max-w-56` -> `max-w-80`
      (320px) gives real names room; `w-full` still lets it shrink on a
      narrow topbar rather than force one. The Tooltip is the ticket's own
      required fallback for whatever still doesn't fit — shown only for a
      genuinely selected branch, never for the always-short "All branches".
    */}
    <Select value={active ?? 'all'} onValueChange={choose} disabled={isSwitching}>
      {/* TooltipTrigger asChild clones its child and forwards a ref, which
          needs a real DOM-rendering element — SelectTrigger, not the
          context-provider Select.Root wrapping it. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger
            className="h-8 w-full max-w-80 text-sm"
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
        </TooltipTrigger>
        {activeBranch ? <TooltipContent side="bottom">{activeBranch.name}</TooltipContent> : null}
      </Tooltip>

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
    </>
  );
}
