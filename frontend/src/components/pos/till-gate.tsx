'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LogIn } from 'lucide-react';

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
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useShiftClock } from '@/hooks/useShiftClock';
import { fetchBranches, type BranchSummary } from '@/lib/branches-api';
import { SaleScreen } from '@/components/pos/sale-screen';

/**
 * A deliberate step before the till, not an instant render (owner's note,
 * 2026-09-09: "I need it to show smth like onboarding screen not an
 * instant one"). Opening the till while off shift asks "ready to start
 * your shift at [Branch]?" instead of dropping straight into a scan field —
 * ties the till directly to a shift being open, so a sale is never rung up
 * with nobody clocked in against it.
 *
 * Reuses `useShiftClock` — the exact same start flow the dedicated Shift
 * page (`/admin/pos/shift`) offers, so starting from here or from there
 * cannot behave differently.
 *
 * ─── WHO MAY SKIP THE CASH COUNT ─────────────────────────────────────
 * Owner's correction, 2026-09-14: "only the admin can skip writing the cash
 * and start the thing". A CASHIER counts their drawer — that count is what
 * their variance is measured against at close, and a shift that skipped it
 * cannot be reconciled at all. An OWNER/DEVELOPER often has no drawer (they
 * are checking something, not working a till), so the skip stays for them.
 *
 * This REPLACES the previous "optional on purpose" reasoning on the float
 * field, which is why that comment is gone rather than left contradicting
 * the code: the null-vs-zero distinction it protected still holds, but the
 * only way to reach a null float is now the admin-only skip below, never an
 * empty box on a cashier's screen.
 *
 * ─── WHY THIS STILL DOES NOT BLOCK SELLING ───────────────────────────
 * `sale-screen.tsx`'s own note covers it: an owner selling outside any shift
 * is real, and the payment simply has no shift attached. Checkout works with
 * no open shift server-side, exactly as it always has.
 */

/** Business-wide roles, who may start a shift with no drawer at all. Mirrors
 *  the backend's own `isBusinessWideRole` — kept as a literal list because
 *  this is a RENDERING hint only; the server re-decides everything it gates. */
const ADMIN_ROLES = ['OWNER', 'DEVELOPER'] as const;

export function TillGate() {
  const t = useTranslations('pos.gate');
  const { user } = useAuth();
  const { shift, isReady, isBusy, needsBranchChoice, start } = useShiftClock();
  const [openingFloat, setOpeningFloat] = useState('');
  const [floatError, setFloatError] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  /** Skipping is remembered only for this page visit, not persisted — the
   *  gate should ask again next time the till is opened, not be dismissed
   *  once and forgotten. */
  const [skipped, setSkipped] = useState(false);

  const isAdmin = user !== null && (ADMIN_ROLES as readonly string[]).includes(user.role);

  /**
   * Loaded only once the server has actually refused on an ambiguous branch.
   *
   * Fetching up front would put a request on the critical path of every till
   * open for the overwhelming majority of cashiers, who work at one branch and
   * never see this control.
   */
  useEffect(() => {
    if (!needsBranchChoice) return;

    void fetchBranches()
      .then(setBranches)
      .catch(() => {
        // The toast from the failed start already said what went wrong. An
        // empty list leaves the selector absent rather than showing a second,
        // competing error for what is really one failure.
        setBranches([]);
      });
  }, [needsBranchChoice]);

  function handleStart() {
    // A cashier's empty float is refused here rather than sent as "0".
    // `Shift.openingFloat` is NULL for "no drawer" and a real number for a
    // counted one (see the schema's own note) — coercing a blank box to 0
    // would record "the drawer was empty" as a counted fact and make every
    // variance derived from it wrong.
    if (!isAdmin && openingFloat.trim() === '') {
      setFloatError(true);
      return;
    }

    setFloatError(false);
    void start(openingFloat, branchId || undefined);
  }

  if (!isReady) {
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-lg border p-8 text-center">
        <Skeleton className="mx-auto h-8 w-48" />
        <Skeleton className="mx-auto h-10 w-full" />
      </div>
    );
  }

  if (shift === null && !skipped) {
    return (
      <div className="mx-auto max-w-md space-y-6 rounded-lg border p-8 text-center">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t('title')}</h2>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>

        {/* Only after the server says it could not tell which branch this
            shift belongs to. The refusal names the problem; this is the
            control that answers it — without it the cashier reads "choose
            today's branch" with nothing on screen to choose from, which is
            the bug this gate had. */}
        {needsBranchChoice && branches.length > 0 ? (
          <div className="space-y-2 text-start">
            <Label htmlFor="till-gate-branch">{t('chooseBranch')}</Label>
            <Select value={branchId} onValueChange={setBranchId} disabled={isBusy}>
              <SelectTrigger id="till-gate-branch" className="w-full">
                <SelectValue placeholder={t('chooseBranchPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{t('chooseBranchHint')}</p>
          </div>
        ) : null}

        <div className="space-y-2 text-start">
          <Label htmlFor="till-gate-float">
            {isAdmin ? t('openingFloat') : t('floatRequired')}
          </Label>
          <Input
            id="till-gate-float"
            value={openingFloat}
            onChange={(event) => {
              setOpeningFloat(event.target.value);
              if (floatError) setFloatError(false);
            }}
            placeholder={t('floatPlaceholder')}
            inputMode="decimal"
            className="force-ltr"
            disabled={isBusy}
            required={!isAdmin}
            aria-invalid={floatError}
            aria-describedby={floatError ? 'till-gate-float-error' : undefined}
          />
          {floatError ? (
            <p id="till-gate-float-error" role="alert" className="text-destructive text-xs">
              {t('floatMissing')}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              {isAdmin ? null : t('floatRequiredHint')}
            </p>
          )}
        </div>

        <Button className="w-full" size="lg" onClick={handleStart} disabled={isBusy}>
          <LogIn className="size-4" aria-hidden />
          {t('startAndOpen')}
        </Button>

        {/* Admin only (owner's correction above). A cashier keeps their shift
            AND their cash count; an owner checking something is not working a
            drawer and should not have to invent a number to get past this. */}
        {isAdmin ? (
          <Button variant="ghost" size="sm" onClick={() => setSkipped(true)} disabled={isBusy}>
            {t('skip')}
          </Button>
        ) : null}
      </div>
    );
  }

  return <SaleScreen />;
}
