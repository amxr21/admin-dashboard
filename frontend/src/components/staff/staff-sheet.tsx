'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
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
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import {
  STAFF_ROLES,
  canAssign,
  createStaff,
  updateStaff,
  type StaffMember,
  type StaffRole,
} from '@/lib/staff-api';

/**
 * Add someone, or change what they can reach.
 *
 * ─── THE ROLE CONTROL MIRRORS THE SERVER'S RULES ─────────────────────
 * Roles above the actor's own rank are not offered, and the control is
 * disabled entirely when editing yourself. Both are COURTESIES — being refused
 * after clicking is worse than seeing it was never available — but
 * staff.service.ts enforces each independently, and anyone can call the
 * endpoint directly.
 *
 * If this list and the server ever disagree, the server is right and this is a
 * bug in the hint, not a hole in the protection.
 */

interface StaffSheetProps {
  member: StaffMember | null;
  actorRole: StaffRole;
  actorId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}


export function StaffSheet({
  member,
  actorRole,
  actorId,
  open,
  onOpenChange,
  onSaved,
}: StaffSheetProps) {
  const t = useTranslations('staff');
  // URG-013 — shared format-example placeholders (see resource-form.tsx's
  // placeholderFor).
  const tCommon = useTranslations('common');
  const tRole = useTranslations('roles');
  const translateError = useTranslatedApiError();
  // The LIVE `security.minPasswordLength`, not a hardcoded 12 — the server
  // enforces it and a local constant drifts as soon as an owner changes it.
  const { editPanelMode, minPasswordLength: MIN_PASSWORD } = useAppSettings();

  const isEdit = member !== null;
  const isSelf = isEdit && member.id === actorId;

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('SUPPORT');
  const [branchId, setBranchId] = useState('');
  const [initialBranchId, setInitialBranchId] = useState('');
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [hasLoadedBranches, setHasLoadedBranches] = useState(false);
  const [branchLoadVersion, setBranchLoadVersion] = useState(0);
  const [isActive, setIsActive] = useState(true);
  // Calendar date only — the picker works in whole days. Sent as end-of-day
  // UTC on that date, the same "inclusive to-date" convention the audit
  // route's own date-range filter uses.
  const [accessExpiresAt, setAccessExpiresAt] = useState('');
  const [password, setPassword] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  /** Hoisted out of PhoneField so the phone's own validation message shares
   *  the one slot its Field owns — see ui/field.tsx. */
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setEmail(member?.email ?? '');
    setName(member?.name ?? '');
    setPhone(member?.phone ?? '');
    setRole(member?.role ?? 'SUPPORT');
    setBranchId('');
    setInitialBranchId('');
    setHasLoadedBranches(false);
    setIsActive(member?.isActive ?? true);
    setAccessExpiresAt(member?.accessExpiresAt ? member.accessExpiresAt.slice(0, 10) : '');
    setPassword('');
    setError(null);
    setEmailError(null);
    setPhoneError(null);
  }, [open, member]);

  useEffect(() => {
    if (!open || isEdit) return;

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
        const preferredId = preferred?.id ?? '';
        setBranchId(preferredId);
        setInitialBranchId(preferredId);
      })
      .catch(() => {
        if (cancelled) return;
        setBranches([]);
        setBranchId('');
        setInitialBranchId('');
        setHasLoadedBranches(true);
        setBranchesError(t('form.branchLoadFailed'));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBranches(false);
      });

    return () => {
      cancelled = true;
    };
  }, [branchLoadVersion, isEdit, open, t]);

  /**
   * Compared against the same expressions the effect above seeds from, so
   * "dirty" means exactly "differs from what this sheet opened with" — no
   * second copy of the initial values to fall out of step with the first.
   *
   * `password` counts even though it seeds empty: a typed-but-unsaved
   * password is precisely the edit worth warning about losing.
   */
  const isDirty =
    open &&
    (email !== (member?.email ?? '') ||
      name !== (member?.name ?? '') ||
      phone !== (member?.phone ?? '') ||
      role !== (member?.role ?? 'SUPPORT') ||
      branchId !== initialBranchId ||
      isActive !== (member?.isActive ?? true) ||
      accessExpiresAt !== (member?.accessExpiresAt ? member.accessExpiresAt.slice(0, 10) : '') ||
      password !== '');

  useUnsavedChangesGuard(isDirty && !isSaving);

  /** Only roles at or below the actor's own rank — rule 1, mirrored. */
  const assignable = STAFF_ROLES.filter((candidate) => canAssign(actorRole, candidate));
  const requiresBranch = role !== 'OWNER' && role !== 'DEVELOPER';
  const branchFieldError =
    branchesError ??
    (hasLoadedBranches && branches.length === 0 ? t('form.noBranches') : undefined);

  async function submit() {
    if (!isEdit) {
      if (!email.trim()) {
        setEmailError(t('form.emailRequired'));
        return;
      }
      if (!isAccountEmailValid(email)) {
        setEmailError(t('form.emailInvalid'));
        return;
      }
    }

    setIsSaving(true);
    setError(null);

    try {
      if (isEdit) {
        const payload: Record<string, unknown> = {
          name: name.trim(),
          phone: phone.trim(),
        };

        // Rule 2, mirrored: never send your own role, active flag, or access
        // expiry — same self-lockout risk as the other two, and the server
        // has no special case for this one either.
        if (!isSelf) {
          payload.role = role;
          payload.isActive = isActive;
          payload.accessExpiresAt = accessExpiresAt
            ? `${accessExpiresAt}T23:59:59.999Z`
            : null;
        }

        const saved = await updateStaff(member.id, payload);
        onSaved(t('notice.updated', { name: saved.name ?? saved.email }));
      } else {
        const saved = await createStaff({
          email: normalizeAccountEmail(email),
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          role,
          password,
          ...(requiresBranch && branchId ? { branchId } : {}),
        });
        onSaved(t('notice.created', { name: saved.name ?? saved.email }));
      }

      onOpenChange(false);
    } catch (caught) {
      // 400 names a field, 403 explains a rule, 409 says the email is taken.
      // All three are sentences worth reading — only the rest get flattened.
      setError(
        caught instanceof ApiError && [400, 403, 409].includes(caught.status)
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSaving(false);
    }
  }

  const canSubmit = isEdit
    ? true
    : email.trim().length > 0 &&
      password.length >= MIN_PASSWORD &&
      (!requiresBranch || Boolean(branchId));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="w-full max-w-md overflow-y-auto"
        title={isEdit ? t('form.editTitle') : t('form.createTitle')}
      >
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            {isEdit ? t('form.editTitle') : t('form.createTitle')}
          </h2>

          {error ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          {isEdit && member.lockedUntil ? (
            // Locked is not deactivated. Saying which avoids an admin resetting
            // a password that was never the problem.
            <p className="bg-warning/10 text-warning rounded-md px-3 py-2 text-sm">
              {t('form.lockedNote')}
            </p>
          ) : null}

          <Field
            id="staff-email"
            label={t('form.fields.email')}
            error={emailError ?? undefined}
          >
            <Input
              id="staff-email"
              // A real type so globals.css forces LTR on the address.
              type="email"
              placeholder={tCommon('placeholders.email')}
              value={email}
              maxLength={255}
              // The email IS the identity here; changing it would silently move
              // an account. Editing it is a separate concern from access.
              disabled={isEdit}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError(null);
              }}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? 'staff-email-error' : undefined}
              onBlur={() => {
                if (email && !isAccountEmailValid(email)) setEmailError(t('form.emailInvalid'));
              }}
            />
          </Field>

          <Field id="staff-name" label={t('form.fields.name')}>
            <Input
              id="staff-name"
              type="text"
              placeholder={tCommon('placeholders.personName')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          {/* URG-020/022. No country context here — a staff record has no
              country field — so this validates against international rules
              rather than assuming one. `onError` hoists the message into the
              Field's one slot rather than PhoneField printing its own. */}
          <Field
            id="staff-phone"
            label={t('form.fields.phone')}
            error={phoneError ?? undefined}
          >
            <PhoneField
              id="staff-phone"
              value={phone}
              onChange={setPhone}
              country={null}
              onError={setPhoneError}
            />
          </Field>

          {!isEdit ? (
            <div className="space-y-2">
              <Label htmlFor="staff-password">{t('form.fields.password')}</Label>
              <PasswordInput
                id="staff-password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby="staff-password-hint"
              />
              <p id="staff-password-hint" className="text-muted-foreground text-sm">
                {t('form.passwordHint', { min: MIN_PASSWORD })}
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="staff-role">{t('form.fields.role')}</Label>
            <Select
              value={role}
              disabled={isSelf}
              onValueChange={(value) => setRole(value as StaffRole)}
            >
              <SelectTrigger id="staff-role">
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
            {isSelf ? (
              <p className="text-muted-foreground text-sm">{t('form.selfRoleNote')}</p>
            ) : null}
          </div>

          {!isEdit && requiresBranch ? (
            <Field
              id="staff-branch"
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
                  id="staff-branch"
                  aria-invalid={branchFieldError ? true : undefined}
                  aria-describedby={
                    branchFieldError ? 'staff-branch-error' : 'staff-branch-hint'
                  }
                >
                  <SelectValue
                    placeholder={
                      isLoadingBranches
                        ? t('form.loadingBranches')
                        : t('form.chooseBranch')
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

          {isEdit && !isSelf ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="staff-active"
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked === true)}
              />
              <Label htmlFor="staff-active">{t('form.fields.isActive')}</Label>
            </div>
          ) : null}

          {isEdit && !isSelf ? (
            <div className="space-y-2">
              <Label htmlFor="staff-access-expires">{t('form.fields.accessExpiresAt')}</Label>
              <DatePicker
                id="staff-access-expires"
                value={accessExpiresAt}
                onChange={setAccessExpiresAt}
              />
              <p className="text-muted-foreground text-sm">{t('form.accessExpiresHint')}</p>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('form.cancel')}
            </Button>
            <Button disabled={isSaving || !canSubmit} onClick={() => void submit()}>
              {isSaving ? t('form.saving') : t('form.save')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
