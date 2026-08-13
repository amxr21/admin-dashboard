'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { KeyRound, UserCog } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ApiError } from '@/lib/api';
import { changeOwnPassword, updateOwnProfile } from '@/lib/auth-api';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useAuth } from '@/hooks/useAuth';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';

/**
 * "Your account" — the identity half of self-service, next to "Your
 * preferences" (language/theme) but a genuinely different shape: THIS
 * section has real fields, a real save, and a server round trip.
 *
 * ─── WHY THIS ISN'T PART OF `PersonalSettingsPanel` ──────────────────
 * That component documents itself as having no fields, no fetch, and no
 * dirty state — language and theme apply instantly with nothing to save.
 * Bolting a name/phone form with its own save button onto that contract
 * would make the one honest sentence in that file's own doc comment false.
 *
 * ─── WHY THIS EXISTS AT ALL ───────────────────────────────────────────
 * `PATCH /staff/:id` (the admin path) requires the `staff` area, which
 * SUPPORT/FULFILLMENT/DEMO don't hold — so before this, a non-admin had NO
 * way to fix a typo in their own name or change their own password without
 * asking an OWNER. `PATCH /auth/me` needs only a session, so this panel is
 * available to every signed-in role.
 */
export function MyAccountPanel() {
  const t = useTranslations('settings');
  const translateError = useTranslatedApiError();
  const { user, updateCachedUser } = useAuth();
  const { editPanelMode, minPasswordLength: MIN_PASSWORD } = useAppSettings();

  const [name, setName] = useState(user?.name ?? '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [changingPassword, setChangingPassword] = useState(false);

  // Re-seed if the cached user changes under us (e.g. resolved after mount).
  useEffect(() => {
    setName(user?.name ?? '');
  }, [user?.name]);

  const isDirty = name.trim() !== (user?.name ?? '');

  async function saveProfile() {
    setIsSavingProfile(true);
    setProfileError(null);

    try {
      const saved = await updateOwnProfile({ name: name.trim() });
      updateCachedUser({ name: saved.name });
      toast.success(t('account.profileSaved'));
    } catch (caught) {
      setProfileError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSavingProfile(false);
    }
  }

  if (!user) return null;

  return (
    <section aria-labelledby="settings-group-account" className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <UserCog className="text-primary size-5" aria-hidden="true" />
          <h2 id="settings-group-account" className="text-lg font-semibold tracking-tight">
            {t('account.title')}
          </h2>
        </div>
        <p className="text-muted-foreground text-sm">{t('account.description')}</p>
      </div>

      <div className="bg-card/50 space-y-4 rounded-lg border p-4">
        {profileError ? (
          <p role="alert" className="text-destructive text-sm">
            {profileError}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="my-account-email">{t('account.email')}</Label>
            {/* Read-only: the email IS the identity here, changing it would
                silently move an account. Same rule as the admin-side staff
                form. */}
            <Input id="my-account-email" value={user.email} disabled className="force-ltr" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="my-account-name">{t('account.name')}</Label>
            <Input
              id="my-account-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button
            size="sm"
            disabled={!isDirty || isSavingProfile}
            onClick={() => void saveProfile()}
          >
            {isSavingProfile ? t('account.saving') : t('account.save')}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setChangingPassword(true)}
          >
            <KeyRound aria-hidden />
            {t('account.changePassword')}
          </Button>
        </div>
      </div>

      {changingPassword ? (
        <ChangePasswordSheet
          editPanelMode={editPanelMode}
          minLength={MIN_PASSWORD}
          onDone={() => setChangingPassword(false)}
        />
      ) : null}
    </section>
  );
}

interface ChangePasswordSheetProps {
  editPanelMode: 'drawer' | 'modal';
  minLength: number;
  onDone: () => void;
}

function ChangePasswordSheet({ editPanelMode, minLength, onDone }: ChangePasswordSheetProps) {
  const t = useTranslations('settings');
  const translateError = useTranslatedApiError();
  const { applyNewToken } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = newPassword.length > 0 && newPassword.length < minLength;
  const canSubmit = currentPassword.length > 0 && newPassword.length >= minLength;

  async function submit() {
    if (!canSubmit) return;

    setIsSaving(true);
    setError(null);

    try {
      const { token } = await changeOwnPassword(currentPassword, newPassword);
      // MUST happen before anything else touches the API — the change just
      // revoked the token this tab was using. Without seeding the fresh one
      // first, the toast below would be the last thing to work this session.
      applyNewToken(token);

      toast.success(t('account.passwordChanged'));
      onDone();
    } catch (caught) {
      // 400 covers both "wrong current password" and "policy violation" —
      // both name the actual problem and are worth showing verbatim.
      setError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onDone();
      }}
    >
      <SheetContent
        variant={editPanelMode}
        title={t('account.changePassword')}
        className="space-y-4"
      >
        <div className="flex items-start gap-3">
          <KeyRound className="text-warning mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">{t('account.changePassword')}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('account.changePasswordDescription')}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="my-account-current-password">{t('account.currentPassword')}</Label>
          <Input
            id="my-account-current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="my-account-new-password">{t('account.newPassword')}</Label>
          <Input
            id="my-account-new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            aria-invalid={tooShort ? true : undefined}
            aria-describedby="my-account-new-password-hint"
          />
          <p
            id="my-account-new-password-hint"
            className={tooShort ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}
          >
            {t('account.passwordHint', { min: minLength })}
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button size="sm" disabled={!canSubmit || isSaving} onClick={() => void submit()}>
            {isSaving ? t('account.saving') : t('account.confirmPasswordChange')}
          </Button>
          <Button variant="outline" size="sm" onClick={onDone}>
            {t('account.cancel')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
