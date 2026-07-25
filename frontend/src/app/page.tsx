import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

/**
 * Temporary token reference page.
 *
 * Two jobs, both of which disappear once real pages exist:
 *   1. Proves Tailwind is actually wired (a misconfigured PostCSS setup renders
 *      an unstyled page that nobody notices until much later).
 *   2. Shows every semantic token in both tiers, so you can eyeball contrast
 *      and see that nothing is a blanket inversion.
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

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">admin-dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Foundations and design tokens are in place. See FOUNDATIONS.md for
            the conventions this project expects.
          </p>
        </div>
        <ThemeToggle />
      </header>

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

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">Chart series</h2>
        <div className="flex gap-2">
          {CHART_TOKENS.map((className) => (
            <div key={className} className={`${className} h-10 flex-1 rounded-md`} />
          ))}
        </div>
      </section>

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
    </main>
  );
}
