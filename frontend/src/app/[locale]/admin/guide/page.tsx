import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  BookOpenCheck,
  Boxes,
  Building2,
  CircleAlert,
  KeyRound,
  Package,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
  House,
  UtensilsCrossed,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { PageTitle } from '@/components/shell/page-title';
import { Link } from '@/i18n/navigation';

const CONTENT_LINKS: ReadonlyArray<{
  href: string;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
}> = [
  { href: '/admin/setup', labelKey: 'setup', descriptionKey: 'setupDescription', icon: BookOpenCheck },
  { href: '/admin/branches', labelKey: 'branches', descriptionKey: 'branchesDescription', icon: Building2 },
  { href: '/admin/r/products', labelKey: 'products', descriptionKey: 'productsDescription', icon: Package },
  { href: '/admin/inventory', labelKey: 'inventory', descriptionKey: 'inventoryDescription', icon: Boxes },
  { href: '/admin/orders', labelKey: 'orders', descriptionKey: 'ordersDescription', icon: ShoppingCart },
  { href: '/admin/staff', labelKey: 'staff', descriptionKey: 'staffDescription', icon: UsersRound },
];

const SECTION_LINKS = [
  'start',
  'templates',
  'brand',
  'catalogue',
  'storefront',
  'operations',
  'access',
  'troubleshooting',
  'security',
] as const;

const API_ENDPOINTS = [
  'GET /api/v1/public/branches',
  'GET /api/v1/public/products?branchId=BRANCH_ID',
  'GET /api/v1/public/products/menu?branchId=BRANCH_ID',
] as const;

function GuideSection({
  id,
  icon: Icon,
  title,
  summary,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;

  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-20 space-y-4">
      <div className="flex items-start gap-3">
        <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{summary}</p>
        </div>
      </div>
      <div className="border-border ms-5 border-s ps-8">{children}</div>
    </section>
  );
}

function NumberedSteps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, index) => (
        <li key={step} className="flex items-start gap-3 text-sm leading-relaxed">
          <span className="bg-secondary text-secondary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
            {index + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The self-service guide is deliberately a Server Component: it has no state,
 * browser API or event handlers. This keeps a large body of help content out of
 * the client bundle while still giving every authenticated role a visible,
 * localized reference inside the application.
 */
export default async function AdminGuidePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('guide');

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageTitle title={t('title')} />

      <header className="bg-primary/5 border-primary/20 rounded-xl border p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <Badge variant="info">{t('badge')}</Badge>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">{t('heroTitle')}</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed sm:text-base">
              {t('heroDescription')}
            </p>
          </div>
          <Link
            href="/admin/settings"
            className="border-input bg-card hover:bg-secondary focus-visible:ring-ring inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <KeyRound className="size-4" aria-hidden />
            {t('openSettings')}
          </Link>
        </div>
      </header>

      <nav aria-label={t('viewNavigation')} className="flex flex-wrap gap-2">
        <Link aria-current="page" className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none" href="/admin/guide">
          {t('guideTab')}
        </Link>
        <Link className="bg-secondary hover:bg-secondary/80 focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none" href="/admin/guide/checklists">
          {t('checklistsTab')}
        </Link>
      </nav>

      <nav aria-label={t('onThisPage')} className="bg-card rounded-lg border p-4">
        <p className="mb-3 text-sm font-semibold">{t('onThisPage')}</p>
        <ul className="flex flex-wrap gap-2">
          {SECTION_LINKS.map((section) => (
            <li key={section}>
              <a
                href={`#${section}`}
                className="bg-secondary text-secondary-foreground hover:bg-primary/10 hover:text-primary focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {t(`sections.${section}.title`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <GuideSection
        id="start"
        icon={BookOpenCheck}
        title={t('sections.start.title')}
        summary={t('sections.start.summary')}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CONTENT_LINKS.map(({ href, labelKey, descriptionKey, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="bg-card hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-ring group min-h-28 rounded-lg border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <Icon className="text-muted-foreground group-hover:text-primary size-5" aria-hidden />
              <p className="mt-3 font-medium">{t(`quickLinks.${labelKey}`)}</p>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                {t(`quickLinks.${descriptionKey}`)}
              </p>
            </Link>
          ))}
        </div>
      </GuideSection>

      <GuideSection
        id="templates"
        icon={UtensilsCrossed}
        title={t('sections.templates.title')}
        summary={t('sections.templates.summary')}
      >
        <div className="space-y-4">
          <div className="bg-warning/10 rounded-lg border border-warning/30 p-4">
            <h3 className="font-semibold">{t('sections.templates.restaurantTitle')}</h3>
            <p className="mt-2 text-sm leading-relaxed">{t('sections.templates.restaurantStatus')}</p>
          </div>

          <div className="bg-primary/5 border-primary/20 rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <House className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
              <div>
                <h3 className="font-semibold">{t('sections.templates.homeBusinessTitle')}</h3>
                <p className="mt-2 text-sm leading-relaxed">{t('sections.templates.homeBusinessStatus')}</p>
                <Link className="text-primary mt-3 inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline" href="/admin/guide/checklists">
                  {t('sections.templates.homeBusinessChecklist')}
                </Link>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <article className="bg-card rounded-lg border p-4">
              <h3 className="font-semibold">{t('sections.templates.appliesTitle')}</h3>
              <ul className="mt-3 list-disc space-y-2 ps-5 text-sm leading-relaxed">
                {(['features', 'labels', 'defaults', 'permissions'] as const).map((item) => (
                  <li key={item}>{t(`sections.templates.applies.${item}`)}</li>
                ))}
              </ul>
            </article>

            <article className="bg-card rounded-lg border p-4">
              <h3 className="font-semibold">{t('sections.templates.missingTitle')}</h3>
              <ul className="mt-3 list-disc space-y-2 ps-5 text-sm leading-relaxed">
                {(['data', 'modifiers', 'tables', 'kitchen', 'recipes', 'payments'] as const).map((item) => (
                  <li key={item}>{t(`sections.templates.missing.${item}`)}</li>
                ))}
              </ul>
            </article>
          </div>

          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('sections.templates.nextStep')}
          </p>
        </div>
      </GuideSection>

      <GuideSection
        id="brand"
        icon={Building2}
        title={t('sections.brand.title')}
        summary={t('sections.brand.summary')}
      >
        <NumberedSteps steps={[
          t('sections.brand.steps.profile'),
          t('sections.brand.steps.branches'),
          t('sections.brand.steps.tax'),
          t('sections.brand.steps.staff'),
          t('sections.brand.steps.verify'),
        ]} />
        <div className="bg-warning/10 text-foreground mt-4 rounded-lg border border-warning/30 p-4 text-sm leading-relaxed">
          <strong>{t('important')}:</strong> {t('sections.brand.warning')}
        </div>
      </GuideSection>

      <GuideSection
        id="catalogue"
        icon={Package}
        title={t('sections.catalogue.title')}
        summary={t('sections.catalogue.summary')}
      >
        <NumberedSteps steps={[
          t('sections.catalogue.steps.categories'),
          t('sections.catalogue.steps.products'),
          t('sections.catalogue.steps.stock'),
          t('sections.catalogue.steps.content'),
          t('sections.catalogue.steps.preview'),
        ]} />
        <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
          {t('sections.catalogue.stockRule')}
        </p>
      </GuideSection>

      <GuideSection
        id="storefront"
        icon={KeyRound}
        title={t('sections.storefront.title')}
        summary={t('sections.storefront.summary')}
      >
        <div className="space-y-5">
          <NumberedSteps steps={[
            t('sections.storefront.steps.key'),
            t('sections.storefront.steps.scope'),
            t('sections.storefront.steps.store'),
            t('sections.storefront.steps.branch'),
            t('sections.storefront.steps.products'),
            t('sections.storefront.steps.checkout'),
            t('sections.storefront.steps.retry'),
          ]} />

          <div className="bg-muted/60 rounded-lg p-4">
            <h3 className="text-sm font-semibold">{t('sections.storefront.requestTitle')}</h3>
            <div className="mt-3 space-y-2" dir="ltr">
              <code className="bg-background block overflow-x-auto rounded-md border px-3 py-2 text-xs whitespace-nowrap">
                X-API-Key: adk_REPLACE_WITH_NEW_KEY
              </code>
              <code className="bg-background block overflow-x-auto rounded-md border px-3 py-2 text-xs whitespace-nowrap">
                Accept-Language: en
              </code>
              <code className="bg-background block overflow-x-auto rounded-md border px-3 py-2 text-xs whitespace-nowrap">
                POST /public/orders: Idempotency-Key: NEW_UUID
              </code>
              {API_ENDPOINTS.map((endpoint) => (
                <code key={endpoint} className="bg-background block overflow-x-auto rounded-md border px-3 py-2 text-xs whitespace-nowrap">
                  {endpoint}
                </code>
              ))}
            </div>
          </div>

          <div className="bg-destructive/10 rounded-lg border border-destructive/30 p-4 text-sm leading-relaxed">
            <strong>{t('sections.storefront.neverTitle')}:</strong> {t('sections.storefront.never')}
          </div>
        </div>
      </GuideSection>

      <GuideSection
        id="operations"
        icon={ReceiptText}
        title={t('sections.operations.title')}
        summary={t('sections.operations.summary')}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {(['opening', 'sale', 'fulfillment', 'return', 'closing'] as const).map((flow) => (
            <article key={flow} className="bg-card rounded-lg border p-4">
              <h3 className="font-medium">{t(`sections.operations.flows.${flow}.title`)}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {t(`sections.operations.flows.${flow}.description`)}
              </p>
            </article>
          ))}
        </div>
      </GuideSection>

      <GuideSection
        id="access"
        icon={UsersRound}
        title={t('sections.access.title')}
        summary={t('sections.access.summary')}
      >
        <NumberedSteps steps={[
          t('sections.access.steps.invite'),
          t('sections.access.steps.branch'),
          t('sections.access.steps.role'),
          t('sections.access.steps.review'),
          t('sections.access.steps.remove'),
        ]} />
        <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
          {t('sections.access.rule')}
        </p>
      </GuideSection>

      <GuideSection
        id="troubleshooting"
        icon={CircleAlert}
        title={t('sections.troubleshooting.title')}
        summary={t('sections.troubleshooting.summary')}
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="bg-muted/60">
              <tr>
                <th scope="col" className="px-4 py-3 text-start font-semibold">{t('sections.troubleshooting.table.status')}</th>
                <th scope="col" className="px-4 py-3 text-start font-semibold">{t('sections.troubleshooting.table.meaning')}</th>
                <th scope="col" className="px-4 py-3 text-start font-semibold">{t('sections.troubleshooting.table.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(['400', '401key', '401customer', '403', '404', '429'] as const).map((error) => (
                <tr key={error}>
                  <th scope="row" className="px-4 py-3 text-start font-medium" dir="auto">
                    {t(`sections.troubleshooting.errors.${error}.status`)}
                  </th>
                  <td className="text-muted-foreground px-4 py-3 leading-relaxed">{t(`sections.troubleshooting.errors.${error}.meaning`)}</td>
                  <td className="px-4 py-3 leading-relaxed">{t(`sections.troubleshooting.errors.${error}.action`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GuideSection>

      <GuideSection
        id="security"
        icon={ShieldCheck}
        title={t('sections.security.title')}
        summary={t('sections.security.summary')}
      >
        <ul className="grid gap-3 sm:grid-cols-2">
          {(['keys', 'accounts', 'backups', 'audit', 'production', 'incident'] as const).map((item) => (
            <li key={item} className="bg-card rounded-lg border p-4 text-sm leading-relaxed">
              {t(`sections.security.items.${item}`)}
            </li>
          ))}
        </ul>
      </GuideSection>
    </div>
  );
}
