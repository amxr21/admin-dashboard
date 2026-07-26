'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { fetchSchema, type ResourceSchema } from '@/lib/resource-api';

/**
 * Fetches the resource schema ONCE and shares it.
 *
 * Both the sidebar and every resource page need it, and without a shared cache
 * each would refetch on navigation — the sidebar re-rendering on every route
 * change would make that one request per page view for data that only changes
 * on deploy.
 *
 * It is fetched at runtime rather than baked in at build time because the API
 * filters it by the caller's permissions. A SUPPORT user genuinely receives a
 * different list from an OWNER, so it cannot be a static import.
 *
 * A failure here is deliberately NOT surfaced as an error screen: the shell
 * must still render so the user can reach the bespoke pages and sign out. The
 * generic pages handle their own missing-schema case.
 */

interface SchemaContextValue {
  resources: ResourceSchema[];
  isLoading: boolean;
  /** True when the fetch failed. The shell renders regardless. */
  failed: boolean;
}

const SchemaContext = createContext<SchemaContextValue>({
  resources: [],
  isLoading: true,
  failed: false,
});

export function SchemaProvider({ children }: { children: ReactNode }) {
  const [resources, setResources] = useState<ResourceSchema[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchSchema()
      .then((next) => {
        if (!cancelled) setResources(next);
      })
      .catch(() => {
        // Swallowed on purpose — see the note above. The nav degrades to its
        // hand-written entries rather than the whole shell failing.
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SchemaContext.Provider value={{ resources, isLoading, failed }}>
      {children}
    </SchemaContext.Provider>
  );
}

export function useResourceSchema(): SchemaContextValue {
  return useContext(SchemaContext);
}
