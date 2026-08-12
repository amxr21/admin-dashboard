'use client';

import { useGSAP } from '@gsap/react';
import { useRef } from 'react';
import { Inbox, Plus, type LucideIcon } from 'lucide-react';

import { gsap } from '@/lib/gsap';
import { DURATION, EASE, DISTANCE, REDUCED } from '@/lib/motion-tokens';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * `ErrorSection`'s visual language (icon + message + action), for the OTHER
 * reason a container has nothing to show: not a failure, just nothing here
 * YET. Before this existed, "empty" was a single line of muted text with no
 * next step — technically correct, but it left a first-time user staring at
 * a blank table with no hint that the fix is one click away. Reserve this for
 * a genuinely empty resource (no rows exist at all); a search or filter that
 * matched nothing is a different message ("no results"), not an invitation to
 * create — see the callers for that split.
 */

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Omit for a resource nobody can create here (e.g. read-only or
   *  externally-sourced data) — the empty state then just explains, with no
   *  next step to offer. */
  action?: {
    label: string;
    onClick: () => void;
    /** Defaults to `Plus`, which suits "create the first one". A filtered
     *  empty state offers "clear filters" instead, where a plus would be
     *  actively misleading about what the button does. */
    icon?: LucideIcon;
  };
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: EmptyStateProps) {
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

          gsap.from('[data-empty-state-reveal]', {
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
      className={cn(
        'flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg p-6 text-center',
        className,
      )}
    >
      <Icon data-empty-state-reveal className="text-muted-foreground size-8" aria-hidden />

      <p data-empty-state-reveal className="text-sm font-medium text-balance">
        {title}
      </p>

      {description ? (
        <p data-empty-state-reveal className="text-muted-foreground text-sm text-pretty">
          {description}
        </p>
      ) : null}

      {action ? (
        (() => {
          const ActionIcon = action.icon ?? Plus;
          return (
            <Button
              data-empty-state-reveal
              variant="outline"
              size="sm"
              onClick={action.onClick}
              className="mt-1"
            >
              <ActionIcon aria-hidden />
              {action.label}
            </Button>
          );
        })()
      ) : null}
    </div>
  );
}
