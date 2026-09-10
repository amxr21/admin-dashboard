'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';

/** Only the latest requested report may update the displayed results. */
export function useReportQuery<T>(query: () => Promise<T>) {
  const translateError = useTranslatedApiError();
  const request = useRef(0);
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const current = ++request.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await query();
      if (current === request.current) setData(result);
    } catch (caught) {
      if (current !== request.current) return;
      setData(null);
      setError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
    } finally {
      if (current === request.current) setIsLoading(false);
    }
  }, [query, translateError]);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  return { data, isLoading, error, setError, load };
}
