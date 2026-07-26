'use client';

import { useGSAP } from '@gsap/react';
import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Construction } from 'lucide-react';

import { gsap } from '@/lib/gsap';
import { DISTANCE, DURATION, EASE } from '@/lib/motion-tokens';

/**
 * A section that exists in the navigation but isn't built yet.
 *
 * ─── WHY A REAL PAGE AND NOT A 404 ───────────────────────────────────
 * The nav advertises these areas, so clicking one and getting "page not found"
 * reads as a broken app rather than an unfinished one. The status code is also
 * a lie: the route is planned, it just has no implementation yet.
 *
 * This states plainly what the section will do and what already works
 * underneath it, so the page is informative rather than an apology.
 */

interface SectionPlaceholderProps {
  /** Translation key under `sections`. */
  section: string;
}

export function SectionPlaceholder({ section }: SectionPlaceholderProps) {
  const t = useTranslations('sections');
  const tCommon = useTranslations('placeholder');
  const container = useRef<HTMLDivElement>(null);

  /**
   * The "already working" list is TRANSLATED, not passed in as a prop.
   *
   * These were English string literals in each page, so an Arabic reader got a
   * right-to-left page with English bullets sitting in the middle of it. They
   * are prose about the product, so they belong with the rest of the prose —
   * and keeping both locales in one file is what stops them drifting apart.
   *
   * `t.raw` because the value is an array; `t` would stringify it. Guarded
   * rather than cast: a missing key returns the key path, and rendering that
   * as a single bullet is worse than rendering nothing.
   */
  const raw: unknown = t.raw(`${section}.ready`);
  const ready = Array.isArray(raw) ? raw.filter((item) => typeof item === 'string') : [];

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

          gsap.from('[data-reveal]', {
            opacity: 0,
            y: motion ? DISTANCE.md : 0,
            duration: motion ? DURATION.base : DURATION.instant,
            ease: EASE.out,
            stagger: motion ? 0.07 : 0,
          });
        },
      );

      return () => media.revert();
    },
    { scope: container },
  );

  return (
    <div ref={container} className="space-y-6">
      <h1 data-reveal className="text-2xl font-semibold">
        {t(`${section}.title`)}
      </h1>

      <div
        data-reveal
        className="bg-card flex flex-col items-start gap-3 rounded-lg border p-6"
      >
        <span className="bg-muted text-muted-foreground inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium">
          <Construction className="size-3.5" aria-hidden />
          {tCommon('inProgress')}
        </span>

        <p className="text-muted-foreground max-w-prose text-pretty">
          {t(`${section}.description`)}
        </p>

        {ready.length > 0 ? (
          <div className="mt-2 w-full">
            <p className="mb-2 text-sm font-medium">{tCommon('alreadyWorking')}</p>
            <ul className="text-muted-foreground space-y-1 text-sm">
              {ready.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  {/* A dot rather than a tick: these are facts about the
                      backend, not completed checklist items for this page. */}
                  <span
                    className="bg-success mt-1.5 size-1.5 shrink-0 rounded-full"
                    aria-hidden
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
