'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneField } from '@/components/ui/phone-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ApiError } from '@/lib/api';
import { readBranchId } from '@/lib/auth-storage';
import { fetchBranches, type BranchSummary } from '@/lib/branches-api';
import { isAccountEmailValid, normalizeAccountEmail } from '@/lib/identity-validation';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { ResetTokenPanel } from '@/components/staff/reset-token-panel';
import type { Locale } from '@/i18n/routing';
import { recoveryPageUrl } from '@/lib/recovery-link';
import {
  STAFF_ROLES,
  canAssign,
  inviteStaff,
  type InviteStaffResult,
  type StaffRole,
} from '@/lib/staff-api';

/**
 * Bring someone onto staff without ever learning their password.
 *
 * ─── A SEPARATE COMPONENT FROM `StaffSheet`, ON PURPOSE ──────────────
 * `StaffSheet` branches on create-vs-edit and self-vs-other, and none of
 * that applies here: there is no password field, no `isActive` toggle (a
 * fresh invite is active by definition), and no self-edit case (nobody
 * invites themselves). Folding this in would mean a THIRD mode threaded
 * through every branch of an already-branchy form.
 *
 * The role control mirrors the server's rank rule the same way
 * `StaffSheet`'s does — a courtesy, not the protection; `staff.service.ts`
 * enforces it independently.
 */

interface InviteStaffSheetProps {
  actorRole: StaffRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the account exists, so the caller can refresh the list
   * WHILE the token-reveal panel is still showing the token. */
  onInvited: () => void;
}

export function InviteStaffSheet({
  actorRole,
  open,
  onOpenChange,
  onInvited,
}: InviteStaffSheetProps) {
  const t = useTranslations('staff');
  const locale = useLocale() as Locale;
  // URG-013 — shared format-example placeholders (see resource-form.tsx's
  // placeholderFor).
  const tCommon = useTranslations('common');
  const tRole = useTranslations('roles');
  const translateError = useTranslatedApiError();
  const { editPanelMode, defaultInviteRole } = useAppSettings();

  const assignable = STAFF_ROLES.filter((candidate) => canAssign(actorRole, candidate));

  /**
   * `staff.defaultInviteRole` pre-selects the picker — but only when the
   * ACTOR can actually grant it. A MANAGER viewing an OWNER-configured
   * default they can't assign falls back to their own highest assignable
   * role rather than opening on a role the dropdown can't even offer.
   */
  function initialRole(): StaffRole {
    if (assignable.includes(defaultInviteRole as StaffRole)) {
      return defaultInviteRole as StaffRole;
    }
    return assignable[0] ?? 'SUPPORT';
  }

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>(initialRole);
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [hasLoadedBranches, setHasLoadedBranches] = useState(false);
  const [branchLoadVersion, setBranchLoadVersion] = useState(0);
  const [accessExpiresAt, setAccessExpiresAt] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [issued, setIssued] = useState<InviteStaffResult | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setIsLoadingBranches(true);
    setHasLoadedBranches(false);
    setBranchesError(null);

    void fetchBranches()
      .then((loaded) => {
        if (cancelled) return;
        setBranches(loaded);
        setHasLoadedBranches(true);
        const activeBranchId = readBranchId();
        const preferred =
          loaded.find((branch) => branch.id === activeBranchId) ??
          loaded.find((branch) => branch.isDefault) ??
          (loaded.length === 1 ? loaded[0] : undefined);
        setBranchId(preferred?.id ?? '');
      })
      .catch(() => {
        if (cancelled) return;
        setBranches([]);
        setBranchId('');
        setHasLoadedBranches(true);
        setBranchesError(t('form.branchLoadFailed'));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBranches(false);
      });

    return () => {
      cancelled = true;
    };
  }, [branchLoadVersion, open, t]);

  function reset() {
    setEmail('');
    setName('');
    setPhone('');
    setRole(initialRole());
    setBranchId('');
    setBranchesError(null);
    setHasLoadedBranches(false);
    setAccessExpiresAt('');
    setError(null);
    setEmailError(null);
    setIssued(null);
  }

  async function submit() {
    if (!email.trim()) {
      setEmailError(t('form.emailRequired'));
      return;
    }
    if (!isAccountEmailValid(email)) {
      setEmailError(t('form.emailInvalid'));
      return;
    }

    const requiresBranch = role !== 'OWNER' && role !== 'DEVELOPER';
    if (requiresBranch && !branchId) {
      setError(branchesError ?? t('form.chooseBranch'));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const result = await inviteStaff({
        email: normalizeAccountEmail(email),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        role,
        ...(requiresBranch && branchId ? { branchId } : {}),
        ...(accessExpiresAt ? { accessExpiresAt: `${accessExpiresAt}T23:59:59.999Z` } : {}),
        activationUrl: recoveryPageUrl(locale),
      });

      // The account exists now — the list should reflect it immediately,
      // WHILE this sheet stays open to reveal the token. Closing first would
      // lose the one-time value before it's shown.
      onInvited();
      setIssued(result);
    } catch (caught) {
      setError(
        caught instanceof ApiError && [400, 403, 409].includes(caught.status)
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (issued) {
    return (
      <ResetTokenPanel
        staffEmail={issued.staff.email}
        token={issued.token}
        expiresAt={issued.expiresAt}
        mode="invite"
        emailed={issued.emailed}
        onDone={() => {
          reset();
          onOpenChange(false);
        }}
      />
    );
  }

  const requiresBranch = role !== 'OWNER' && role !== 'DEVELOPER';
  const branchFieldError =
    branchesError ??
    (hasLoadedBranches && branches.length === 0 ? t('form.noBranches') : undefined);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onOpenChange(false);
        }
      }}
    >
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="w-full max-w-md overflow-y-auto"
        title={t('invite.title')}
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t('invite.title')}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('invite.description')}</p>
          </div>

          {error ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="invite-email">{t('form.fields.email')}</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder={tCommon('placeholders.email')}
              value={email}
              maxLength={255}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError(null);
              }}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? 'invite-email-error' : undefined}
              onBlur={() => {
                if (email && !isAccountEmailValid(email)) setEmailError(t('form.emailInvalid'));
              }}
            />
            {emailError ? (
              <p id="invite-email-error" role="alert" className="text-destructive text-sm">
                {emailError}
              </p>
            ) : null}
          </div>

          {requiresBranch ? (
            <Field
              id="invite-branch"
              label={t('form.fields.branch')}
              required
              error={branchFieldError}
              description={t('form.branchHint')}
            >
              <Select
                value={branchId}
                disabled={isLoadingBranches || branches.length === 0}
                onValueChange={setBranchId}
              >
                <SelectTrigger
                  id="invite-branch"
                  aria-invalid={branchFieldError ? true : undefined}
                >
                  <SelectValue
                    placeholder={
                      isLoadingBranches ? t('form.loadingBranches') : t('form.chooseBranch')
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.businessName} · {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {branchesError ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBranchLoadVersion((version) => version + 1)}
                >
                  {t('form.retryBranches')}
                </Button>
              ) : null}
            </Field>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="invite-name">{t('form.fields.name')}</Label>
            <Input id="invite-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-phone">{t('form.fields.phone')}</Label>
            {/* URG-020/022 — same international-only validation as the staff
                sheet, for the same reason: no country field on the record. */}
            <PhoneField
              id="invite-phone"
              value={phone}
              onChange={setPhone}
              country={null}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-role">{t('form.fields.role')}</Label>
            <Select value={role} onValueChange={(value) => setRole(value as StaffRole)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignable.map((candidate) => (
                  <SelectItem key={candidate} value={candidate}>
                    {tRole(candidate)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-access-expires">{t('form.fields.accessExpiresAt')}</Label>
            <DatePicker
              id="invite-access-expires"
              value={accessExpiresAt}
              onChange={setAccessExpiresAt}
            />
            <p className="text-muted-foreground text-sm">{t('form.accessExpiresHint')}</p>
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('form.cancel')}
            </Button>
            <Button
              disabled={isSaving || !email.trim() || (requiresBranch && !branchId)}
              onClick={() => void submit()}
            >
              {isSaving ? t('form.saving') : t('invite.send')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
