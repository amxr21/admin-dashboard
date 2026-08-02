'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Lets a page (a Server Component, most of the time) hand a title to the
 * shell's top bar — Phase 2 of the design pass moved the dashboard's `<h1>`
 * out of the content area and into the top bar's inline-start region, so the
 * first data pixel sits directly below one control band instead of below a
 * separate title row.
 *
 * ─── WHY A CONTEXT, NOT A ROUTE-DERIVED TITLE ────────────────────────
 * `AppShell` already knows the current pathname and could derive a title from
 * the same nav config `GlobalSearch` uses — but that would put a title in the
 * top bar for EVERY page, including ones that still render their own local
 * `<h1>`, producing a duplicate title on every page not yet migrated. An
 * explicit opt-in means only pages that actually removed their own heading
 * show one here; everything else is unaffected until it's deliberately
 * migrated. `<PageTitle>` is that opt-in — render it once per page, in place
 * of the `<h1>` it replaces.
 */

interface PageTitleContextValue {
  title: string | null;
  setTitle: (title: string | null) => void;
}

const PageTitleContext = createContext<PageTitleContextValue>({
  title: null,
  setTitle: () => {},
});

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  return (
    <PageTitleContext.Provider value={{ title, setTitle }}>{children}</PageTitleContext.Provider>
  );
}

/** Consumed by `AppShell` to render the current page's title in the top bar. */
export function usePageTitle(): string | null {
  return useContext(PageTitleContext).title;
}

/**
 * Rendered by an opted-in PAGE (inside `<main>`) to register its title with
 * the shell. Renders nothing itself — the actual heading lives in the top
 * bar, driven by the same context this writes to.
 */
export function PageTitle({ title }: { title: string }) {
  const { setTitle } = useContext(PageTitleContext);

  useEffect(() => {
    setTitle(title);
    // Clears on unmount so navigating to a page that HASN'T opted in doesn't
    // keep showing the previous page's title in the top bar.
    return () => setTitle(null);
  }, [title, setTitle]);

  return null;
}
