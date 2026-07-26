'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { ErrorScreen } from '@/components/errors/error-screen';
import { ResourceTable } from '@/components/resource/resource-table';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchSchema, type ResourceSchema } from '@/lib/resource-api';

/**
 * Resolves a resource name to its schema, then renders the table.
 *
 * A name with no schema is a genuine "doesn't exist" — the same answer the API
 * gives — so it renders the not-found screen rather than an empty table. An
 * empty table would suggest the resource exists and has no rows, which is a
 * different and misleading statement.
 *
 * The schema is also permission-filtered server-side, so a resource the user
 * cannot reach is absent here too, and lands on the same screen.
 */
export function ResourceView({ resource }: { resource: string }) {
  const t = useTranslations('errorPages.notFound');
  const translateError = useTranslatedApiError();

  const [schema, setSchema] = useState<ResourceSchema | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      setNotFound(false);

      try {
        const resources = await fetchSchema();
        if (cancelled) return;

        const match = resources.find((entry) => entry.resource === resource);

        if (!match) {
          setNotFound(true);
          return;
        }

        setSchema(match);
      } catch (caught) {
        if (!cancelled) setError(translateError(caught));
      } finally {
        // Guarded so a resolved fetch from a previous resource can't clear the
        // loading state of the current one after a fast navigation.
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [resource, translateError]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full max-w-sm" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorScreen
        title={t('title')}
        description={error}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (notFound || !schema) {
    return <ErrorScreen title={t('title')} description={t('description')} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{schema.label}</h1>
      <ResourceTable schema={schema} />
    </div>
  );
}
