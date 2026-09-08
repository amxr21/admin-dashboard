'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImageOff, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  browseCategories,
  browseProducts,
  type BrowseCategory,
  type BrowsedProduct,
} from '@/lib/pos-api';

/**
 * The grid a cashier taps instead of scanning (O9.10).
 *
 * ─── WHY THIS EXISTS ALONGSIDE THE SCAN FIELD, NOT INSTEAD OF IT ─────
 * Counted against the live catalogue when this was built: 30 products, 1
 * barcode. The owner confirmed the shop will not be barcoding its stock, so
 * for the other 29 the scan field had no way to find them at all — a cashier
 * would have to type an exact SKU from memory. This grid is now the PRIMARY
 * way most products get sold; the scan field stays exactly as exact as it
 * was, for the few that do carry a code.
 *
 * ─── WHY THIS IS NOT scanProduct WITH A "FUZZY" FLAG ─────────────────
 * The scan's exactness is a correctness property — a mistyped digit must
 * never silently resolve to a DIFFERENT product. Mixing that into the same
 * function as a searchable, paginated, name-matched list is how that
 * property quietly grows an escape hatch. `browseProducts` is a separate
 * backend function for the same reason.
 *
 * ─── WHY TAPPING ADDS DIRECTLY, WITH NO CONFIRM STEP ─────────────────
 * A scan adds on Enter with no confirmation either — the cart line is the
 * confirmation, and the quantity stepper right there is how a mis-tap gets
 * corrected. A confirm dialog on every tap would make the grid slower than
 * the SKU-typing it exists to replace.
 */

interface ProductGridProps {
  onAdd: (product: BrowsedProduct) => void;
  disabled?: boolean;
}

/** Debounced the same amount as the resource table's own search box — long
 *  enough that a name typed at normal speed does not refetch per keystroke,
 *  short enough that it still reads as instant. */
const SEARCH_DEBOUNCE_MS = 250;

export function ProductGrid({ onAdd, disabled = false }: ProductGridProps) {
  const t = useTranslations('pos.grid');

  const [categories, setCategories] = useState<BrowseCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<BrowsedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Loaded once. The category LIST changes as rarely as the resource
    // engine's own category admin — the grid's own product fetch below is
    // what refetches on every keystroke and tab change, not this.
    void browseCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      setIsLoading(true);
      setError(false);

      void browseProducts({ q: query, categoryId: activeCategory ?? undefined })
        .then(setProducts)
        .catch(() => setError(true))
        .finally(() => setIsLoading(false));
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, activeCategory]);

  const showEmpty = !isLoading && !error && products.length === 0;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
          className="ps-9"
          disabled={disabled}
        />
      </div>

      {categories.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant={activeCategory === null ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveCategory(null)}
            disabled={disabled}
          >
            {t('allCategories')}
          </Button>
          {categories.map((category) => (
            <Button
              key={category.id}
              type="button"
              variant={activeCategory === category.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveCategory(category.id)}
              disabled={disabled}
            >
              {category.name}
            </Button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {t('loadFailed')}
        </p>
      ) : null}

      {showEmpty ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          {query.trim() ? t('noMatches') : t('empty')}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {isLoading
          ? // Index as key is fine here — fixed-count loading placeholders,
            // never reordered or individually removed.
            Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="aspect-square rounded-lg" />
            ))
          : products.map((product) => (
              <ProductTile
                key={product.id}
                product={product}
                onAdd={() => onAdd(product)}
                disabled={disabled}
              />
            ))}
      </div>
    </div>
  );
}

function ProductTile({
  product,
  onAdd,
  disabled,
}: {
  product: BrowsedProduct;
  onAdd: () => void;
  disabled: boolean;
}) {
  const t = useTranslations('pos.grid');
  const [imageFailed, setImageFailed] = useState(false);

  // Out of stock at THIS branch is shown, never hidden — the same reasoning
  // as the cart's over-stock warning: the cashier decides, the server is the
  // one that actually refuses the sale.
  const isOutOfStock = product.branchStock !== null && product.branchStock <= 0;

  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={disabled}
      className="border-border bg-card hover:bg-accent focus-visible:ring-ring flex flex-col overflow-hidden rounded-lg border text-start transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
    >
      <div className="bg-muted relative flex aspect-square items-center justify-center overflow-hidden">
        {product.imageUrl && !imageFailed ? (
          // Plain <img>, not next/image — same reasoning as resource-cell.tsx:
          // the URL is admin-supplied/Cloudinary-hosted at runtime, not a
          // build-time known host next/image could be configured for.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt=""
            className="size-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <ImageOff className="text-muted-foreground size-6" aria-hidden />
        )}

        {isOutOfStock ? (
          <span className="bg-destructive/90 text-destructive-foreground absolute inset-x-0 bottom-0 px-1.5 py-0.5 text-center text-xs font-medium">
            {t('outOfStock')}
          </span>
        ) : null}
      </div>

      <div className="space-y-0.5 p-2">
        <p className="truncate text-sm font-medium">{product.name}</p>
        <p className="text-muted-foreground text-sm tabular-nums">{product.price}</p>
      </div>
    </button>
  );
}
