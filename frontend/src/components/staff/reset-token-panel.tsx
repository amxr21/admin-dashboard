'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, KeyRound, TriangleAlert } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Shows a freshly issued password-reset token — once.
 *
 * Same one-time-reveal contract as `AccessCodePanel`, and deliberately the same
 * shape: the server stores only an HMAC, so this really is the only time the
 * token is readable. Dismissing without copying it means issuing another.
 *
 * ─── WHY A TOKEN AND NOT JUST SETTING THE PASSWORD ───────────────────
 * Setting a password directly (the other button on the row) means the admin
 * knows the credential their colleague is about to use. Handing over a
 * single-use token instead means they never do — the locked-out person picks
 * their own password at /reset-password. Both paths exist because handing over
 * a token requires the other person to be reachable; setting one directly does
 * not.
 */

interface ResetTokenPanelProps {
  staffEmail: string;
  token: string;
  /** ISO timestamp — the token stops working after this. */
  expiresAt: string;
  onDone: () => void;
}

export function ResetTokenPanel({
  staffEmail,
  token,
  expiresAt,
  onDone,
}: ResetTokenPanelProps) {
  const t = useTranslations('staff.resetToken');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (insecure context, permissions). The
      // token is on screen and selectable, so this is a convenience failing,
      // not the feature failing — say nothing rather than raise an alarm.
      setCopied(false);
    }
  }

  // Rendered in the reader's locale rather than as a raw ISO string, but
  // deliberately absolute (not "in 30 minutes") — a relative label goes stale
  // while the dialog sits open.
  const expiryLabel = new Date(expiresAt).toLocaleString();

  return (
    <AlertDialog open onOpenChange={() => {}}>
      <AlertDialogContent
        className="max-w-md space-y-4"
        // Deliberate dismissal only, same as the access-code reveal.
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <div className="flex items-start gap-3">
          <KeyRound className="text-warning mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <AlertDialogTitle className="font-medium">
              {t('title', { email: staffEmail })}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-1 flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {t('shownOnce')}
            </AlertDialogDescription>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* force-ltr and tabular-nums: this is a credential, so it must not
              reorder in an Arabic layout. `select-all` makes one click select
              the whole thing when copy is unavailable. */}
          <code className="bg-card force-ltr flex-1 select-all rounded-md border px-3 py-2 text-center text-lg font-medium tracking-widest tabular-nums">
            {token}
          </code>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void copy()}
                aria-label={t('copy')}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('copy')}</TooltipContent>
          </Tooltip>
        </div>

        <p className="text-muted-foreground text-sm">{t('expires', { at: expiryLabel })}</p>
        <p className="text-muted-foreground text-sm">{t('handOver')}</p>

        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            {copied ? t('copied') : t('copyHint')}
          </p>
          <Button size="sm" onClick={onDone}>
            {t('done')}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
