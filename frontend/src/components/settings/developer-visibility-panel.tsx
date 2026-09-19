'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EyeOff, ShieldCheck } from 'lucide-react';

import { AREAS, type Area } from '@/config/areas';
import { useAuth } from '@/hooks/useAuth';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { ApiError } from '@/lib/api';
import {
  fetchDeveloperVisibility,
  setDeveloperVisibility,
} from '@/lib/roles-api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorSection } from '@/components/errors/error-section';
import { Skeleton } from '@/components/ui/skeleton';

export function DeveloperVisibilityPanel() {
  const t = useTranslations('settings.developerVisibility');
  const areaT = useTranslations('setup.areas');
  const { user } = useAuth();
  const translateError = useTranslatedApiError();
  const [areas, setAreas] = useState<Area[]>([]);
  const [hiddenAreas, setHiddenAreas] = useState<Area[]>([]);
  const [savedHiddenAreas, setSavedHiddenAreas] = useState<Area[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowed = user?.role === 'OWNER';
  const isDirty = hiddenAreas.length !== savedHiddenAreas.length ||
    hiddenAreas.some((area) => !savedHiddenAreas.includes(area));

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void fetchDeveloperVisibility()
      .then((data) => {
        if (cancelled) return;
        const available = data.areas.filter((area): area is Area => AREAS.includes(area));
        const hidden = data.hiddenAreas.filter((area): area is Area => available.includes(area));
        setAreas(available);
        setHiddenAreas(hidden);
        setSavedHiddenAreas(hidden);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : translateError(caught));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [allowed, translateError]);

  if (!allowed) return null;
  if (isLoading) {
    return <section className="space-y-4 border-t pt-8" aria-labelledby="developer-visibility-title"><h2 id="developer-visibility-title" className="sr-only">{t('title')}</h2><Skeleton className="h-6 w-64" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></section>;
  }
  if (error) {
    return <ErrorSection title={t('title')} description={error} onRetry={() => window.location.reload()} />;
  }

  function toggle(area: Area, checked: boolean) {
    setHiddenAreas((current) => checked
      ? [...current, area]
      : current.filter((value) => value !== area));
  }

  async function save() {
    setIsSaving(true);
    setError(null);
    try {
      const next = await setDeveloperVisibility(hiddenAreas);
      const hidden = next.hiddenAreas.filter((area): area is Area => areas.includes(area));
      setHiddenAreas(hidden);
      setSavedHiddenAreas(hidden);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="space-y-4 border-t pt-8" aria-labelledby="developer-visibility-title">
      <div className="flex items-start gap-3">
        <EyeOff className="text-primary mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <h2 id="developer-visibility-title" className="text-lg font-semibold tracking-tight">{t('title')}</h2>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
          <p className="text-muted-foreground text-sm">{t('infrastructureNote')}</p>
        </div>
      </div>

      <div className="bg-muted/40 flex items-start gap-2 rounded-lg border p-3 text-sm">
        <ShieldCheck className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>{t('accessNote')}</p>
      </div>

      {error ? <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">{error}</p> : null}

      <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="sr-only">{t('legend')}</legend>
        {areas.map((area) => {
          const id = `developer-visibility-${area}`;
          return (
            <label key={area} htmlFor={id} className="bg-card hover:bg-muted/60 flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring">
              <Checkbox id={id} checked={hiddenAreas.includes(area)} onCheckedChange={(checked) => toggle(area, checked === true)} aria-describedby={`${id}-hint`} />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{areaT(area)}</span>
                <span id={`${id}-hint`} className="text-muted-foreground text-xs">{t('hideArea')}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="flex items-center gap-3 border-t pt-4">
        <Button disabled={!isDirty || isSaving} onClick={() => void save()}>{isSaving ? t('saving') : t('save')}</Button>
        {!isDirty && savedHiddenAreas.length > 0 ? <p role="status" className="text-muted-foreground text-sm">{t('saved')}</p> : null}
      </div>
    </section>
  );
}
