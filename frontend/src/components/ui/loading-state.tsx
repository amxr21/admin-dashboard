'use client';

import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

export function LoadingState({ label }: { label?: string }) {
  const t = useTranslations('common');
  return (
    <div role="status" className="flex min-h-48 flex-col items-center justify-center gap-3 p-6">
      <Loader2 aria-hidden className="text-primary size-6 animate-spin motion-reduce:animate-none" />
      <p className="text-muted-foreground text-sm">{label ?? t('loading')}</p>
    </div>
  );
}
