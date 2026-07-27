'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, KeyRound, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Shows a freshly issued access code — once.
 *
 * ─── WHY THIS SCREEN HAS TO BE EMPHATIC ──────────────────────────────
 * The server stores only an HMAC, so this really is the only time the code
 * exists in readable form. If it is dismissed without being written down, it is
 * gone and the courier needs a new one.
 *
 * That is the correct behaviour for a credential, but it is NOT what people
 * expect from a UI — most values can be looked at again. So the warning is
 * prominent, dismissal is a deliberate click rather than a click-outside, and
 * copying is one button so nobody transcribes it by eye.
 */

interface AccessCodePanelProps {
  courierName: string;
  code: string;
  onDone: () => void;
}

export function AccessCodePanel({ courierName, code, onDone }: AccessCodePanelProps) {
  const t = useTranslations('delivery.accessCode');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (insecure context, permissions). The
      // code is on screen and selectable, so this is a convenience failing,
      // not the feature failing — say nothing rather than raise an alarm.
      setCopied(false);
    }
  }

  return (
    <div
      role="alertdialog"
      aria-label={t('title', { name: courierName })}
      className="border-warning/40 bg-warning/5 space-y-4 rounded-lg border p-4"
    >
      <div className="flex items-start gap-3">
        <KeyRound className="text-warning mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">{t('title', { name: courierName })}</p>
          <p className="text-muted-foreground mt-1 flex items-start gap-1.5 text-sm">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('shownOnce')}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* force-ltr and tabular-nums: this is a code, so it must not reorder
            in an Arabic layout and its characters must align. `select-all`
            makes one click select the whole thing when copy is unavailable. */}
        <code className="bg-card force-ltr flex-1 select-all rounded-md border px-3 py-2 text-center text-lg font-medium tracking-widest tabular-nums">
          {code}
        </code>

        <Button variant="outline" size="icon" onClick={() => void copy()} aria-label={t('copy')}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {copied ? t('copied') : t('copyHint')}
        </p>
        {/* Deliberate dismissal. No click-outside, no Escape — losing this by
            brushing the wrong pixel means reissuing. */}
        <Button size="sm" onClick={onDone}>
          {t('done')}
        </Button>
      </div>
    </div>
  );
}
