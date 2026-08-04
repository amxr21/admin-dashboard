'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ApiError } from '@/lib/api';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
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

const MIN_PASSWORD = 12;

export function StaffSheet({
  member,
  actorRole,
  actorId,
  open,
  onOpenChange,
  onSaved,
}: StaffSheetProps) {
  const t = useTranslations('staff');
  const tRole = useTranslations('staffRole');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const isEdit = member !== null;
  const isSelf = isEdit && member.id === actorId;

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('SUPPORT');
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setEmail(member?.email ?? '');
    setName(member?.name ?? '');
    setPhone(member?.phone ?? '');
    setRole(member?.role ?? 'SUPPORT');
    setIsActive(member?.isActive ?? true);
    setPassword('');
    setError(null);
    setEmailError(null);
  }, [open, member]);

  /** Only roles at or below the actor's own rank — rule 1, mirrored. */
  const assignable = STAFF_ROLES.filter((candidate) => canAssign(actorRole, candidate));

  async function submit() {
    if (!isEdit && !email.trim()) {
      setEmailError(t('form.emailRequired'));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      if (isEdit) {
        const payload: Record<string, unknown> = {
          name: name.trim(),
          phone: phone.trim(),
        };

        // Rule 2, mirrored: never send your own role or active flag. The
        // server refuses both, so sending them would only produce an error.
        if (!isSelf) {
          payload.role = role;
          payload.isActive = isActive;
        }

        const saved = await updateStaff(member.id, payload);
        onSaved(t('notice.updated', { name: saved.name ?? saved.email }));
      } else {
        const saved = await createStaff({
          email: email.trim(),
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          role,
          password,
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
    : email.trim().length > 0 && password.length >= MIN_PASSWORD;

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

          <div className="space-y-2">
            <Label htmlFor="staff-email">{t('form.fields.email')}</Label>
            <Input
              id="staff-email"
              // A real type so globals.css forces LTR on the address.
              type="email"
              value={email}
              // The email IS the identity here; changing it would silently move
              // an account. Editing it is a separate concern from access.
              disabled={isEdit}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError(null);
              }}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? 'staff-email-error' : undefined}
            />
            {emailError ? (
              <p id="staff-email-error" role="alert" className="text-destructive text-sm">
                {emailError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="staff-name">{t('form.fields.name')}</Label>
            <Input
              id="staff-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="staff-phone">{t('form.fields.phone')}</Label>
            <Input
              id="staff-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>

          {!isEdit ? (
            <div className="space-y-2">
              <Label htmlFor="staff-password">{t('form.fields.password')}</Label>
              <Input
                id="staff-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby="staff-password-hint"
              />
              <p id="staff-password-hint" className="text-muted-foreground text-sm">
                {t('form.passwordHint')}
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
