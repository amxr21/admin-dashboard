'use client';

import { useGSAP } from '@gsap/react';
import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { TriangleAlert } from 'lucide-react';

import { gsap } from '@/lib/gsap';
import { DURATION, EASE, DISTANCE, REDUCED } from '@/lib/motion-tokens';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * `ErrorScreen`'s visual language (icon + message + retry), sized to fill a
 * CONTAINER rather than the viewport.
 *
 * ─── WHY THIS EXISTS SEPARATELY FROM ErrorScreen ─────────────────────
 * A card, a table, or a report widget failing to load is not the same event
 * as the whole page failing — the rest of the shell (nav, other widgets) is
 * still fine, so covering the viewport and offering "back to dashboard" would
 * be both wrong (there is no dashboard-level problem) and disruptive (it
 * blows away everything else on the page). Before this component existed,
 * every surface improvised its own ad hoc error banner — a different look
 * every time. This is the one shared shape; embed it, don't invent another.
 *
 * No "back to dashboard" link and no reference id: those are page-level
 * concepts. A section either recovers with retry or the caller decides what
 * else to show.
 */

interface ErrorSectionProps {
  title: string;
  description: string;
  /** Rendered as the retry action. Omit for cases with nothing to retry. */
  onRetry?: () => void;
  className?: string;
}

export function ErrorSection({ title, description, onRetry, className }: ErrorSectionProps) {
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

          // Same pattern as ErrorScreen, scaled down: a widget failing isn't
          // a big moment, so the reveal is quick rather than absent.
          gsap.from('[data-error-section-reveal]', {
            opacity: 0,
            y: motion ? DISTANCE.sm : 0,
            duration: motion ? DURATION.fast : REDUCED.duration,
            ease: EASE.out,
            stagger: motion ? 0.04 : 0,
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
      role="alert"
      className={cn(
        'flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center',
        className,
      )}
    >
      <TriangleAlert
        data-error-section-reveal
        className="text-destructive size-8"
        aria-hidden
      />

      <p data-error-section-reveal className="text-sm font-medium text-balance">
        {title}
      </p>

      <p data-error-section-reveal className="text-muted-foreground text-sm text-pretty">
        {description}
      </p>

      {onRetry ? (
        <Button
          data-error-section-reveal
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-1"
        >
          {t('actions.retry')}
        </Button>
      ) : null}
    </div>
  );
}
