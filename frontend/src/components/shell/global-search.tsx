'use client';

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';

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
import { cn } from '@/lib/utils';

/**
 * Quick-nav: jump straight to a destination by typing its name, instead of
 * hunting through the sidebar's groups. This is NOT a content search — it
 * has no index of orders, customers or products to search INSIDE, only the
 * same destinations the sidebar already links to (hand-written pages + the
 * schema-driven resources), filtered by what `role` can actually reach.
 * Full cross-entity content search would need a real backend endpoint — see
 * the Phase 1 report for that flag.
 */

const MAX_RESULTS = 8;

interface Result {
  href: string;
  label: string;
  icon: NavItem['icon'];
}

export function GlobalSearch({ role }: { role: StaffRole }) {
  const t = useTranslations('nav');
  const router = useRouter();
  const { resources } = useResourceSchema();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<Result[]>(() => {
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
        href: item.href,
        label: t.has(item.labelKey) ? t(item.labelKey) : item.labelKey,
        icon: item.icon,
      }));
  }, [resources, role, t]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items.filter((item) => item.label.toLowerCase().includes(q)).slice(0, MAX_RESULTS);
  }, [items, query]);

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

  return (
    <Popover open={open && results.length > 0}>
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
            aria-expanded={open && results.length > 0}
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
        className="w-64 p-1"
      >
        {results.map((result, index) => (
          <button
            key={result.href}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            // mousedown, not click: fires before the input's onBlur closes
            // the popover, so the click actually lands.
            onMouseDown={(event) => {
              event.preventDefault();
              go(result.href);
            }}
            onMouseEnter={() => setActiveIndex(index)}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm',
              // Primary-tinted, not `--accent` (amber) — matches the sidebar's
              // own active-link treatment, so "highlighted here" and
              // "selected there" read as the same concept.
              index === activeIndex
                ? 'bg-primary/10 text-primary'
                : 'text-foreground hover:bg-muted',
            )}
          >
            <result.icon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{result.label}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
