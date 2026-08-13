import { apiFetch } from '@/lib/api';

/**
 * Cross-entity search (C4.2) — orders, customers, products by name/SKU.
 * Backs `global-search.tsx`'s content-search half; destination-jump (page
 * names) stays entirely client-side, since that list is small and static.
 */

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface SearchResults {
  orders: SearchHit[];
  customers: SearchHit[];
  products: SearchHit[];
}

export async function search(query: string): Promise<SearchResults> {
  return apiFetch<SearchResults>(`/search?q=${encodeURIComponent(query)}`);
}
