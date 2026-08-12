'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
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
 * Quick-nav + content search, in one box.
 *
 * Two result GROUPS, from two different sources:
 * - **Pages** — destinations the sidebar already links to (hand-written
 *   pages + schema-driven resources), filtered by role, matched client-side
 *   against a small static list. Instant, no round trip.
 * - **Orders / Customers / Products** — real rows, from `GET /search`
 *   (search.route.ts), debounced so a fast typist doesn't fire one request
 *   per keystroke. Each group is independently gated server-side by the
 *   caller's own areas (see search.service.ts) — a role missing an area
 *   just never sees that group, not a 403 for the whole box.
 *
 * C4.2: this used to be destination-jump ONLY, with its own doc comment
 * stating plainly that it had no index of orders/customers/products to
 * search inside. That was verified true (a repo-wide grep for a matching
 * backend endpoint found none) before building this — not assumed missing.
 */

const MAX_PAGE_RESULTS = 5;
const CONTENT_DEBOUNCE_MS = 250;
/** Below this, content search doesn't fire — matches search.service.ts's
 *  own `MIN_QUERY_LENGTH`, so the box never shows a spinner for a query the
 *  server would short-circuit anyway. */
const MIN_CONTENT_QUERY_LENGTH = 2;

interface PageResult {
  kind: 'page';
  href: string;
  label: string;
  icon: NavItem['icon'];
}

interface ContentResult {
  kind: 'order' | 'customer' | 'product';
  href: string;
  label: string;
  subtitle: string | null;
}

type Result = PageResult | ContentResult;

export function GlobalSearch({ role }: { role: StaffRole }) {
  const t = useTranslations('nav');
  const router = useRouter();
  const { resources } = useResourceSchema();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [contentGroups, setContentGroups] = useState<{
    orders: SearchHit[];
    customers: SearchHit[];
    products: SearchHit[];
  }>({ orders: [], customers: [], products: [] });
  const [isSearchingContent, setIsSearchingContent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // C4.6 — `/` focuses search from anywhere, matching the same convention
  // GitHub/Linear/Slack use. Guarded on the currently-focused element so it
  // doesn't hijack a `/` a user is typing into an unrelated field (a search
  // box, a note, a URL slug) — same "don't fire while text input has focus"
  // rule the ⌘K command palette doesn't need (that shortcut has no printable
  // character to collide with).
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (isTyping) return;

      event.preventDefault();
      inputRef.current?.focus();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

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

  // Debounced content search — a real network call, unlike the page list
  // above, so it must not fire on every keystroke.
  useEffect(() => {
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
  }, [query]);

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

  const results = useMemo<Result[]>(
    () => [...pageResults, ...contentResults],
    [pageResults, contentResults],
  );

  function go(href: string) {
    router.push(href);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;

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
        if (target) go(target.href);
        break;
      }
      case 'Escape':
        setOpen(false);
        break;
      default:
        break;
    }
  }

  const showPopover = open && (results.length > 0 || isSearchingContent);

  return (
    <Popover open={showPopover}>
      <PopoverAnchor asChild>
        <div className="relative hidden w-64 lg:block">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={showPopover}
            aria-controls="global-search-results"
            aria-label={t('search')}
            placeholder={t('searchPlaceholder')}
            value={query}
            className="ps-9"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
          {isSearchingContent ? (
            <Loader2
              className="text-muted-foreground absolute top-1/2 end-3 size-4 -translate-y-1/2 animate-spin"
              aria-hidden
            />
          ) : null}
        </div>
      </PopoverAnchor>

      <PopoverContent
        id="global-search-results"
        role="listbox"
        align="start"
        // Keeps focus (and the input's own blur handler) on the input —
        // selection happens via keyboard or onMouseDown below, which fires
        // before the input's blur.
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-72 p-1"
      >
        <ResultGroup
          labelKey="searchGroups.pages"
          results={pageResults}
          results0={0}
          activeIndex={activeIndex}
          onSelect={go}
          onHover={setActiveIndex}
        />
        <ResultGroup
          labelKey="searchGroups.orders"
          results={contentResults.filter((r) => r.kind === 'order')}
          results0={pageResults.length}
          activeIndex={activeIndex}
          onSelect={go}
          onHover={setActiveIndex}
        />
        <ResultGroup
          labelKey="searchGroups.customers"
          results={contentResults.filter((r) => r.kind === 'customer')}
          results0={pageResults.length + contentGroups.orders.length}
          activeIndex={activeIndex}
          onSelect={go}
          onHover={setActiveIndex}
        />
        <ResultGroup
          labelKey="searchGroups.products"
          results={contentResults.filter((r) => r.kind === 'product')}
          results0={pageResults.length + contentGroups.orders.length + contentGroups.customers.length}
          activeIndex={activeIndex}
          onSelect={go}
          onHover={setActiveIndex}
        />

        {results.length === 0 && !isSearchingContent && query.trim().length > 0 ? (
          <p className="text-muted-foreground px-2 py-3 text-center text-sm">{t('searchGroups.noResults')}</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * One labelled section of the results list. Renders nothing (not even the
 * heading) when its slice is empty — an empty "Products" heading above
 * nothing reads as a rendering bug, same discipline `sidebar-nav.tsx`
 * already applies to a permission-emptied nav group.
 */
function ResultGroup({
  labelKey,
  results,
  results0,
  activeIndex,
  onSelect,
  onHover,
}: {
  labelKey: string;
  results: Result[];
  /** This group's offset into the FLAT, merged results array — `activeIndex`
   *  is one number spanning every group, so highlighting has to translate
   *  back from "3rd item in Products" to "index 3 overall". */
  results0: number;
  activeIndex: number;
  onSelect: (href: string) => void;
  onHover: (index: number) => void;
}) {
  const t = useTranslations('nav');
  if (results.length === 0) return null;

  return (
    <div className="mb-1 last:mb-0">
      <p className="text-muted-foreground px-2 py-1 text-xs font-medium tracking-wide uppercase">
        {t(labelKey)}
      </p>
      {results.map((result, i) => {
        const index = results0 + i;
        return (
          <button
            key={`${result.kind}-${result.href}-${result.label}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            // mousedown, not click: fires before the input's onBlur closes
            // the popover, so the click actually lands.
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(result.href);
            }}
            onMouseEnter={() => onHover(index)}
            className={cn(
              'flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-start text-sm',
              // Primary-tinted, not `--accent` (amber) — matches the sidebar's
              // own active-link treatment, so "highlighted here" and
              // "selected there" read as the same concept.
              index === activeIndex ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
            )}
          >
            {result.kind === 'page' ? (
              <result.icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{result.label}</span>
              {result.kind !== 'page' && result.subtitle ? (
                <span className="text-muted-foreground block truncate text-xs">{result.subtitle}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
