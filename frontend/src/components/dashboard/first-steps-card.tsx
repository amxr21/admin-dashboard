'use client';

import { useTranslations } from 'next-intl';
import { Rocket } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * "Let's get your first order in" — shown instead of a page of zeros to a
 * business that has never taken an order, in BOTH dashboard modes. It used to
 * live inside SimpleDashboard only, so an owner on the full dashboard met an
 * empty grid with no pointer to the launch checklist.
 */
export function FirstStepsCard() {
  const t = useTranslations('dashboard');

  return (
    <section className="bg-card rounded-lg border p-5 shadow-xs" aria-labelledby="first-steps-title">
      <div className="flex items-start gap-3">
        <span className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg" aria-hidden>
          <Rocket className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 id="first-steps-title" className="font-semibold">
            {t('simple.firstSteps.title')}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">{t('simple.firstSteps.body')}</p>
          <Button asChild size="sm" className="mt-3">
            <Link href="/admin/guide/checklists">{t('simple.firstSteps.action')}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
