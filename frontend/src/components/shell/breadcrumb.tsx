'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';

import { Link } from '@/i18n/navigation';

/**
 * Lets a detail page hand its own trail (Orders → ORD-1024) to the shell's
 * top bar — same shape as `page-title.tsx`'s context, and for the same
 * reason: an explicit opt-in means only pages that actually have a trail
 * worth showing render one, rather than deriving something from the route
 * for every page including ones with nothing meaningful to say (the
 * dashboard, list pages that ARE the top of their own hierarchy).
 *
 * Distinct from `PageTitle` — that's a single string a page hands up to
 * REPLACE where its own `<h1>` would sit; a breadcrumb is a trail rendered
 * ABOVE a page's own heading (see C4.7's "orders = page" rule — a detail
 * page keeps its own local `<h1>`, this sits above it, not instead of it).
 */

export interface BreadcrumbSegment {
  label: string;
  /** Omit for the trailing (current) segment — the page you're already on
   *  isn't a link to itself. */
  href?: string;
}

interface BreadcrumbContextValue {
  segments: BreadcrumbSegment[] | null;
  setSegments: (segments: BreadcrumbSegment[] | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  segments: null,
  setSegments: () => {},
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [segments, setSegments] = useState<BreadcrumbSegment[] | null>(null);
  return (
    <BreadcrumbContext.Provider value={{ segments, setSegments }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

/** Consumed by `AppShell` to render the current page's trail in the top bar. */
export function useBreadcrumbSegments(): BreadcrumbSegment[] | null {
  return useContext(BreadcrumbContext).segments;
}

/**
 * Rendered by an opted-in detail page to register its trail with the shell.
 * Renders nothing itself — the actual trail lives in the top bar.
 *
 * The LAST segment should never carry `href` — it names the page you're
 * already on, and Radix's own breadcrumb convention (which this follows
 * without pulling in a new primitive for two links and a separator) marks
 * that one `aria-current="page"` instead of making it a link to itself.
 */
export function Breadcrumb({ segments }: { segments: BreadcrumbSegment[] }) {
  const { setSegments } = useContext(BreadcrumbContext);

  useEffect(() => {
    setSegments(segments);
    // Clears on unmount so navigating to a page that hasn't opted in
    // doesn't keep showing the previous page's trail.
    return () => setSegments(null);
    // `segments` is a fresh array every render from most callers (built
    // inline from fetched data) — comparing by JSON keeps this effect from
    // re-firing (and re-triggering the mount/unmount churn below) on every
    // parent render when the actual trail content hasn't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(segments), setSegments]);

  return null;
}

/** Rendered by `AppShell` in the top bar when a page has registered a trail. */
export function BreadcrumbHost({ segments }: { segments: BreadcrumbSegment[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;

        return (
          <span key={`${segment.label}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 ? (
              <>
                <ChevronRight className="text-muted-foreground/60 size-3.5 shrink-0 rtl:hidden" aria-hidden />
                <ChevronLeft
                  className="text-muted-foreground/60 hidden size-3.5 shrink-0 rtl:block"
                  aria-hidden
                />
              </>
            ) : null}
            {segment.href && !isLast ? (
              <Link
                href={segment.href}
                className="text-muted-foreground hover:text-foreground min-w-0 truncate hover:underline"
              >
                {segment.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? 'page' : undefined}
                className={isLast ? 'min-w-0 truncate font-medium' : 'text-muted-foreground min-w-0 truncate'}
              >
                {segment.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
