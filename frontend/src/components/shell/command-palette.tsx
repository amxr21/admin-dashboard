'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import {
  LogOut,
  Moon,
  PackagePlus,
  Search,
  Sun,
  TicketPlus,
  type LucideIcon,
} from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useResourceSchema } from '@/components/providers/schema-provider';
import { useRouter } from '@/i18n/navigation';
import {
  NAVIGATION,
  RESOURCES_OUTSIDE_SIDEBAR,
  RESOURCE_ICONS,
  RESOURCE_ICON_FALLBACK,
  type NavItem,
} from '@/config/navigation';
import { canAccessArea, type StaffRole } from '@/config/areas';
import { search as searchContent, type SearchHit } from '@/lib/search-api';
import { cn } from '@/lib/utils';

/**
 * C4.3 — ⌘K/Ctrl+K from anywhere in the admin area. The MASTER_TODO spec
 * names three capabilities: jump to a page, jump to a record by ID, run an
 * action. The first two are the exact same two result sources
 * `global-search.tsx` already built for the topbar box (destination pages,
 * client-side; orders/customers/products, via `GET /search`) — reused here
 * rather than reimplemented, so the two surfaces can never quietly diverge
 * on what counts as a match. The third is new: a short, real action list
 * (never a placeholder item pretending to do something it doesn't).
 *
 * Deliberately NOT built on `global-search.tsx`'s Popover-anchored
 * component directly — a command palette is a centered, keyboard-summoned
 * MODAL with its own trigger (a global keydown listener, not a click), so
 * the two share data-fetching shape but not markup.
 */

const MAX_PAGE_RESULTS = 5;
const CONTENT_DEBOUNCE_MS = 250;
const MIN_CONTENT_QUERY_LENGTH = 2;

interface PageResult {
  kind: 'page';
  href: string;
  label: string;
  icon: LucideIcon;
}

interface ContentResult {
  kind: 'order' | 'customer' | 'product';
  href: string;
  label: string;
  subtitle: string | null;
}

interface ActionResult {
  kind: 'action';
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
}

type Result = PageResult | ContentResult | ActionResult;

export function CommandPalette({
  role,
  onSignOut,
}: {
  role: StaffRole;
  onSignOut?: () => void;
}) {
  const t = useTranslations('nav');
  const tPalette = useTranslations('commandPalette');
  const router = useRouter();
  const { resources } = useResourceSchema();
  const { resolvedTheme, setTheme } = useTheme();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [contentGroups, setContentGroups] = useState<{
    orders: SearchHit[];
    customers: SearchHit[];
    products: SearchHit[];
  }>({ orders: [], customers: [], products: [] });
  const [isSearchingContent, setIsSearchingContent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global trigger — ⌘K on macOS, Ctrl+K everywhere else. Mounted once,
  // regardless of which page is open, so the palette is reachable from
  // anywhere in the admin area, matching the spec's own framing ("from
  // anywhere") rather than being scoped to a page that happens to render it.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Focuses the input the instant the dialog finishes opening — Radix's own
  // `onOpenAutoFocus` already does this for the Content element, but the
  // actual typing target is the Input inside it, one level down.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      const timer = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const pageItems = useMemo<PageResult[]>(() => {
    const navItems = NAVIGATION.flatMap((group) => group.items);
    const resourceItems: NavItem[] = resources
      .filter((resource) => !RESOURCES_OUTSIDE_SIDEBAR.includes(resource.resource))
      .map((resource) => ({
        href: `/admin/r/${resource.resource}`,
        labelKey: resource.resource,
        icon: RESOURCE_ICONS[resource.resource] ?? RESOURCE_ICON_FALLBACK,
        area: resource.permissionArea as NavItem['area'],
      }));

    return [...navItems, ...resourceItems]
      .filter((item) => !item.area || canAccessArea(role, item.area))
      .map((item) => ({
        kind: 'page' as const,
        href: item.href,
        label: t.has(item.labelKey) ? t(item.labelKey) : item.labelKey,
        icon: item.icon,
      }));
  }, [resources, role, t]);

  const pageResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return pageItems.filter((item) => item.label.toLowerCase().includes(q)).slice(0, MAX_PAGE_RESULTS);
  }, [pageItems, query]);

  useEffect(() => {
    if (!open) return;

    const q = query.trim();
    if (q.length < MIN_CONTENT_QUERY_LENGTH) {
      setContentGroups({ orders: [], customers: [], products: [] });
      setIsSearchingContent(false);
      return;
    }

    setIsSearchingContent(true);
    let cancelled = false;

    const timer = setTimeout(() => {
      searchContent(q)
        .then((results) => {
          if (cancelled) return;
          setContentGroups(results);
        })
        .catch(() => {
          if (cancelled) return;
          setContentGroups({ orders: [], customers: [], products: [] });
        })
        .finally(() => {
          if (!cancelled) setIsSearchingContent(false);
        });
    }, CONTENT_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  const contentResults = useMemo<ContentResult[]>(() => {
    const toResult = (kind: ContentResult['kind']) => (hit: SearchHit): ContentResult => ({
      kind,
      href: hit.href,
      label: hit.title,
      subtitle: hit.subtitle,
    });

    return [
      ...contentGroups.orders.map(toResult('order')),
      ...contentGroups.customers.map(toResult('customer')),
      ...contentGroups.products.map(toResult('product')),
    ];
  }, [contentGroups]);

  // Every action here is REAL — matches Quick Actions on the dashboard
  // (C1.4), which already ruled out "Create order" as having no backend
  // path. Never a placeholder entry that would do nothing when chosen.
  const actionResults = useMemo<ActionResult[]>(() => {
    const actions: ActionResult[] = [
      {
        kind: 'action',
        id: 'add-product',
        label: tPalette('actions.addProduct'),
        icon: PackagePlus,
        run: () => router.push('/admin/r/products'),
      },
      {
        kind: 'action',
        id: 'create-discount',
        label: tPalette('actions.createDiscount'),
        icon: TicketPlus,
        run: () => router.push('/admin/r/discounts'),
      },
      {
        kind: 'action',
        id: 'toggle-theme',
        label:
          resolvedTheme === 'dark' ? tPalette('actions.switchToLight') : tPalette('actions.switchToDark'),
        icon: resolvedTheme === 'dark' ? Sun : Moon,
        run: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
      },
    ];

    if (onSignOut) {
      actions.push({
        kind: 'action',
        id: 'sign-out',
        label: tPalette('actions.signOut'),
        icon: LogOut,
        run: onSignOut,
      });
    }

    const q = query.trim().toLowerCase();
    if (!q) return [];
    return actions.filter((action) => action.label.toLowerCase().includes(q));
  }, [query, tPalette, router, resolvedTheme, setTheme, onSignOut]);

  const results = useMemo<Result[]>(
    () => [...pageResults, ...contentResults, ...actionResults],
    [pageResults, contentResults, actionResults],
  );

  function select(result: Result) {
    if (result.kind === 'action') {
      result.run();
    } else {
      router.push(result.href);
    }
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % results.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + results.length) % results.length);
        break;
      case 'Enter': {
        event.preventDefault();
        const target = results[activeIndex] ?? results[0];
        if (target) select(target);
        break;
      }
      default:
        break;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="top-[20%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0"
        // The palette IS the whole surface — a separately-announced title
        // would be redundant with the input's own label, but Radix requires
        // one for assistive tech, so it's visually hidden rather than
        // omitted (omitting it is a console warning AND a real a11y gap).
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{tPalette('title')}</DialogTitle>

        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <Input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="command-palette-results"
            aria-label={tPalette('title')}
            placeholder={tPalette('placeholder')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            className="border-0 shadow-none focus-visible:ring-0"
          />
        </div>

        <div
          id="command-palette-results"
          role="listbox"
          className="max-h-96 overflow-y-auto p-1"
        >
          <PaletteGroup
            labelKey="pages"
            results={pageResults}
            results0={0}
            activeIndex={activeIndex}
            onSelect={select}
            onHover={setActiveIndex}
          />
          <PaletteGroup
            labelKey="orders"
            results={contentResults.filter((r) => r.kind === 'order')}
            results0={pageResults.length}
            activeIndex={activeIndex}
            onSelect={select}
            onHover={setActiveIndex}
          />
          <PaletteGroup
            labelKey="customers"
            results={contentResults.filter((r) => r.kind === 'customer')}
            results0={pageResults.length + contentGroups.orders.length}
            activeIndex={activeIndex}
            onSelect={select}
            onHover={setActiveIndex}
          />
          <PaletteGroup
            labelKey="products"
            results={contentResults.filter((r) => r.kind === 'product')}
            results0={pageResults.length + contentGroups.orders.length + contentGroups.customers.length}
            activeIndex={activeIndex}
            onSelect={select}
            onHover={setActiveIndex}
          />
          <PaletteGroup
            labelKey="actions"
            results={actionResults}
            results0={pageResults.length + contentResults.length}
            activeIndex={activeIndex}
            onSelect={select}
            onHover={setActiveIndex}
          />

          {results.length === 0 && !isSearchingContent && query.trim().length > 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              {tPalette('noResults')}
            </p>
          ) : null}

          {query.trim().length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              {tPalette('hint')}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PaletteGroup({
  labelKey,
  results,
  results0,
  activeIndex,
  onSelect,
  onHover,
}: {
  labelKey: string;
  results: Result[];
  results0: number;
  activeIndex: number;
  onSelect: (result: Result) => void;
  onHover: (index: number) => void;
}) {
  const tPalette = useTranslations('commandPalette');
  if (results.length === 0) return null;

  return (
    <div className="mb-1 last:mb-0">
      <p className="text-muted-foreground px-2 py-1 text-xs font-medium tracking-wide uppercase">
        {tPalette(`groups.${labelKey}`)}
      </p>
      {results.map((result, i) => {
        const index = results0 + i;
        const key =
          result.kind === 'action' ? `action-${result.id}` : `${result.kind}-${result.href}-${result.label}`;
        const Icon = result.kind === 'page' || result.kind === 'action' ? result.icon : null;

        return (
          <button
            key={key}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(result);
            }}
            onMouseEnter={() => onHover(index)}
            className={cn(
              'flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-start text-sm',
              index === activeIndex ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
            )}
          >
            {Icon ? <Icon className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{result.label}</span>
              {result.kind !== 'page' && result.kind !== 'action' && result.subtitle ? (
                <span className="text-muted-foreground block truncate text-xs">{result.subtitle}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
