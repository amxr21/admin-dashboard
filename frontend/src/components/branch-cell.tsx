'use client';

import { useTranslations } from 'next-intl';
import { Store } from 'lucide-react';

/**
 * A branch's name in a list row (O1).
 *
 * Null renders an em dash, not a blank and not a guessed name: a row without a
 * branch means one of two real things — it predates branch scoping, or its
 * branch was removed — and both are "not recorded", which is a different fact
 * from "belongs to the branch you happen to be looking at".
 */
export function BranchCell({
  branch,
}: {
  branch: { id: string; name: string; code: string | null } | null;
}) {
  const t = useTranslations('branches.manage');

  if (!branch) {
    return (
      <span className="text-muted-foreground" title={t('noBranch')}>
        —
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <Store className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{branch.name}</span>
    </span>
  );
}
