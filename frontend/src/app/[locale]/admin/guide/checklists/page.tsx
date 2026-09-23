import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClipboardCheck } from 'lucide-react';

import { ChecklistBoard, type ChecklistGroup } from '@/components/guide/checklist-board';
import { PageTitle } from '@/components/shell/page-title';
import { Link } from '@/i18n/navigation';

const GROUPS = {
  setup: ['owner', 'profile', 'currency', 'tax', 'notifications', 'security'],
  branch: ['identity', 'timezone', 'selling', 'staff', 'stock', 'test'],
  catalogue: ['categories', 'products', 'prices', 'images', 'translations', 'branchStock', 'soldOut'],
  storefront: ['key', 'scopes', 'secret', 'branches', 'catalogue', 'languages', 'idempotency', 'guestOrder', 'customerOrder', 'rotation'],
  opening: ['branch', 'shift', 'drawer', 'devices', 'stock', 'alerts'],
  closing: ['orders', 'returns', 'deliveries', 'cash', 'shift', 'exceptions'],
  staff: ['invite', 'role', 'assignment', 'activation', 'twoFactor', 'review', 'offboard'],
  incident: ['contain', 'revoke', 'sessions', 'audit', 'evidence', 'restore'],
  release: ['commit', 'backup', 'migrations', 'builds', 'bilingual', 'accessibility', 'acceptance', 'monitoring', 'rollback'],
} as const;

export default async function GuideChecklistsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('guide');

  const groups: ChecklistGroup[] = Object.entries(GROUPS).map(([groupId, itemIds]) => ({
    id: groupId,
    title: t(`checklists.groups.${groupId}.title`),
    description: t(`checklists.groups.${groupId}.description`),
    items: itemIds.map((itemId) => ({
      id: `${groupId}.${itemId}`,
      label: t(`checklists.groups.${groupId}.items.${itemId}.label`),
      detail: t(`checklists.groups.${groupId}.items.${itemId}.detail`),
    })),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageTitle title={t('checklists.title')} />

      <header className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
            <ClipboardCheck className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t('checklists.title')}</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{t('checklists.subtitle')}</p>
          </div>
        </div>

        <nav aria-label={t('viewNavigation')} className="flex flex-wrap gap-2">
          <Link className="bg-secondary hover:bg-secondary/80 focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none" href="/admin/guide">
            {t('guideTab')}
          </Link>
          <Link aria-current="page" className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none" href="/admin/guide/checklists">
            {t('checklistsTab')}
          </Link>
        </nav>
      </header>

      <ChecklistBoard
        groups={groups}
        copy={{
          completed: t('checklists.completed'),
          completeGroup: t('checklists.completeGroup'),
          resetAll: t('checklists.resetAll'),
          resetTitle: t('checklists.resetTitle'),
          resetDescription: t('checklists.resetDescription'),
          cancel: t('checklists.cancel'),
          confirmReset: t('checklists.confirmReset'),
          savedLocally: t('checklists.savedLocally'),
          saveFailed: t('checklists.saveFailed'),
        }}
      />
    </div>
  );
}
