import { getTranslations, setRequestLocale } from 'next-intl/server';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { StatusBadge } from '@/components/status-badge';
import { Reveal } from '@/components/motion/reveal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Temporary reference page.
 *
 * Three jobs, all of which disappear once real pages exist:
 *   1. Proves Tailwind is actually wired (a misconfigured PostCSS setup renders
 *      an unstyled page that nobody notices until much later).
 *   2. Shows every semantic token in both tiers, so contrast is eyeballable and
 *      nothing is a blanket inversion.
 *   3. Renders each primitive so RTL and dark mode can be checked at a glance.
 *
 * Delete this when the first real page lands.
 */

const SURFACE_TOKENS = [
  { name: 'background', className: 'bg-background text-foreground' },
  { name: 'card', className: 'bg-card text-card-foreground' },
  { name: 'secondary', className: 'bg-secondary text-secondary-foreground' },
  { name: 'muted', className: 'bg-muted text-muted-foreground' },
] as const;

const STATUS_TOKENS = [
  { name: 'primary', className: 'bg-primary text-primary-foreground' },
  { name: 'accent', className: 'bg-accent text-accent-foreground' },
  { name: 'success', className: 'bg-success text-success-foreground' },
  { name: 'warning', className: 'bg-warning text-warning-foreground' },
  { name: 'destructive', className: 'bg-destructive text-destructive-foreground' },
  { name: 'info', className: 'bg-info text-info-foreground' },
] as const;

const CHART_TOKENS = [
  'bg-chart-1',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-5',
] as const;

/** Every order status, so each badge tone is visible in one place. */
const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'SHIPPED',
  'DELIVERED',
  'CANCELED',
  'RETURNED',
] as const;

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Keeps this page statically rendered despite reading translations.
  setRequestLocale(locale);

  const t = await getTranslations('counts');

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">admin-dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {/* Exercises ICU pluralisation in both locales — Arabic resolves
                `few` here, which English has no equivalent for. */}
            {t('products', { count: 3 })}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      {/* Staggered by increasing delay so sections arrive in reading order
          rather than all at once — the eye follows a sequence, not a flash. */}
      <Reveal>
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium">Surfaces</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SURFACE_TOKENS.map((token) => (
              <div
                key={token.name}
                className={`${token.className} border-border rounded-lg border p-4 text-xs`}
              >
                {token.name}
              </div>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal delay={0.06}>
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium">Status</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {STATUS_TOKENS.map((token) => (
              <div
                key={token.name}
                className={`${token.className} rounded-lg p-4 text-xs font-medium`}
              >
                {token.name}
              </div>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal delay={0.12}>
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium">Chart series</h2>
          <div className="flex gap-2">
            {CHART_TOKENS.map((className) => (
              <div key={className} className={`${className} h-10 flex-1 rounded-md`} />
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal delay={0.18}>
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium">Order statuses</h2>
          {/* Translated labels, tone mapped by meaning. Switch language to see
              both change together. */}
          <div className="flex flex-wrap gap-2">
            {ORDER_STATUSES.map((status) => (
              <StatusBadge key={status} kind="orderStatus" value={status} />
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal delay={0.24}>
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium">Form controls</h2>
          <div className="max-w-sm space-y-4">
            <div className="space-y-2">
              <Label htmlFor="demo-email">Email</Label>
              {/* type="email" so globals.css forces LTR — an email address must
                  not visually reorder inside an Arabic form. */}
              <Input id="demo-email" type="email" placeholder="you@company.com" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="demo-check" />
              <Label htmlFor="demo-check">Checkbox</Label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </section>
      </Reveal>

      <Reveal delay={0.3}>
        <section>
          <h2 className="mb-3 text-sm font-medium">Button variants</h2>
          <div className="flex flex-wrap gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
        </section>
      </Reveal>
    </main>
  );
}
