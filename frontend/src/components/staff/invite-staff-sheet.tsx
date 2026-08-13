'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
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
import { ResetTokenPanel } from '@/components/staff/reset-token-panel';
import {
  STAFF_ROLES,
  canAssign,
  inviteStaff,
  type ResetTokenResult,
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
  const tRole = useTranslations('staffRole');
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
  const [accessExpiresAt, setAccessExpiresAt] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [issued, setIssued] = useState<ResetTokenResult | null>(null);

  function reset() {
    setEmail('');
    setName('');
    setPhone('');
    setRole(initialRole());
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

    setIsSaving(true);
    setError(null);

    try {
      const result = await inviteStaff({
        email: email.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        role,
        ...(accessExpiresAt ? { accessExpiresAt: `${accessExpiresAt}T23:59:59.999Z` } : {}),
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
        onDone={() => {
          reset();
          onOpenChange(false);
        }}
      />
    );
  }

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
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError(null);
              }}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? 'invite-email-error' : undefined}
            />
            {emailError ? (
              <p id="invite-email-error" role="alert" className="text-destructive text-sm">
                {emailError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-name">{t('form.fields.name')}</Label>
            <Input id="invite-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-phone">{t('form.fields.phone')}</Label>
            <Input
              id="invite-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
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
            <Button disabled={isSaving || !email.trim()} onClick={() => void submit()}>
              {isSaving ? t('form.saving') : t('invite.send')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
