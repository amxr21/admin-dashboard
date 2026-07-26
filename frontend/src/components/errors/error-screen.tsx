'use client';

import { useGSAP } from '@gsap/react';
import { useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { gsap } from '@/lib/gsap';
import { DURATION, EASE, DISTANCE } from '@/lib/motion-tokens';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * The one error surface for the whole app.
 *
 * ─── NO STATUS CODES, EVER ───────────────────────────────────────────
 * A visitor cannot act on "404" or "500". Those are numbers for the people who
 * wrote the server, and showing them makes a recoverable moment feel like the
 * product is broken. Every case here says, in a sentence, WHAT HAPPENED and
 * WHAT TO DO NEXT.
 *
 * The reference id is the exception, and only because it is actionable in the
 * other direction: it maps to the exact backend log lines, so quoting it in a
 * bug report turns an unreproducible complaint into a two-minute lookup.
 */

interface ErrorScreenProps {
  title: string;
  description: string;
  /** Backend requestId or Next.js digest. Shown small, never as the headline. */
  reference?: string;
  /** Rendered as the primary action. Omit for cases with nothing to retry. */
  onRetry?: () => void;
  children?: ReactNode;
}

export function ErrorScreen({
  title,
  description,
  reference,
  onRetry,
  children,
}: ErrorScreenProps) {
  const t = useTranslations('errorPages');
  const container = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();

      media.add(
        {
          motion: '(prefers-reduced-motion: no-preference)',
          reduced: '(prefers-reduced-motion: reduce)',
        },
        (context) => {
          const { motion } = context.conditions as { motion: boolean };

          // An error screen appears when something already went wrong; a big
          // animation reads as flippant. Reduced motion gets a plain fade.
          gsap.from('[data-error-reveal]', {
            opacity: 0,
            y: motion ? DISTANCE.sm : 0,
            duration: motion ? DURATION.base : DURATION.fast,
            ease: EASE.out,
            stagger: motion ? 0.06 : 0,
          });
        },
      );

      return () => media.revert();
    },
    { scope: container },
  );

  return (
    <div
      ref={container}
      // role="alert" would interrupt a screen reader mid-sentence. This IS the
      // page, so it is announced on navigation anyway.
      className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <h1 data-error-reveal className="text-2xl font-semibold text-balance">
        {title}
      </h1>

      <p data-error-reveal className="text-muted-foreground text-pretty">
        {description}
      </p>

      <div data-error-reveal className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {onRetry ? <Button onClick={onRetry}>{t('actions.retry')}</Button> : null}
        <Button variant={onRetry ? 'outline' : 'default'} asChild>
          <Link href="/admin">{t('actions.backToDashboard')}</Link>
        </Button>
        {children}
      </div>

      {reference ? (
        <p
          data-error-reveal
          className="text-muted-foreground mt-4 text-xs"
        >
          {t('reference')}{' '}
          {/* force-ltr: an id is a code and must not reorder in Arabic. */}
          <code className="force-ltr bg-muted rounded px-1.5 py-0.5 font-mono">
            {reference}
          </code>
        </p>
      ) : null}
    </div>
  );
}
