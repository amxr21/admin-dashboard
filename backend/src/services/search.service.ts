import type { StaffRole } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { canAccessArea, type Area } from '../config/roles.js';
import {
  localizeProductRows,
  type ProductLocale,
} from './product-content.service.js';

/**
 * Cross-entity search — orders, customers, products by name/SKU — for the
 * frontend's global search box (`global-search.tsx`, C4.2). Separate from
 * `resource.service.ts`'s `listResource`: that function is keyed by a
 * resource NAME and returns full paginated rows shaped for a table; this
 * returns a handful of lightweight, uniformly-shaped hits across THREE
 * different tables (one of which, orders, isn't even a generic resource —
 * see orders.service.ts's own note on why it's bespoke) for a dropdown.
 * Forcing that through `listResource` per-resource would mean three
 * separate calls with three different row shapes the frontend would have
 * to normalise anyway — this does that normalisation once, server-side.
 *
 * Each category is gated by its OWN area, independently — a role that can
 * see orders but not products gets order hits and no product section at
 * all, not an empty one. Matches `resource.route.ts`'s schema endpoint's
 * own per-resource `canAccessArea` filtering rather than an all-or-nothing
 * route guard, which cannot express "some categories, not others."
 */

const MAX_RESULTS_PER_CATEGORY = 5;
/** A query below this is almost certainly still being typed — running it
 *  against every category on every keystroke is wasted load for a result
 *  set too broad to be useful anyway. */
const MIN_QUERY_LENGTH = 2;

export interface SearchResult {
  id: string;
  /** What to show as the primary line — an order number, a customer name, a
   *  product name. */
  title: string;
  /** A second, smaller line for disambiguation — customer email under an
   *  order number, SKU under a product name. Omitted when there's nothing
   *  useful to add. */
  subtitle: string | null;
  href: string;
}

export interface SearchResults {
  orders: SearchResult[];
  customers: SearchResult[];
  products: SearchResult[];
  suppliers: SearchResult[];
  customerCases: SearchResult[];
}

function money(value: { toFixed: (digits: number) => string }): string {
  return value.toFixed(2);
}

export async function search(
  role: StaffRole,
  query: string,
  branchId: string | null,
  locale: ProductLocale = 'en',
): Promise<SearchResults> {
  const q = query.trim();

  const empty: SearchResults = { orders: [], customers: [], products: [], suppliers: [], customerCases: [] };
  if (q.length < MIN_QUERY_LENGTH) return empty;

  const canSee = (area: Area) => canAccessArea(role, area);

  const [orders, customers, products, suppliers, customerCases] = await Promise.all([
    canSee('orders')
      ? prisma.order.findMany({
          where: {
            ...(branchId ? { branchId } : {}),
            OR: [
              { orderNumber: { contains: q } },
              { customer: { name: { contains: q } } },
              { customer: { email: { contains: q } } },
            ],
          },
          select: { id: true, orderNumber: true, total: true, customer: { select: { name: true } } },
          orderBy: { placedAt: 'desc' },
          take: MAX_RESULTS_PER_CATEGORY,
        })
      : Promise.resolve([]),
    canSee('customers')
      ? prisma.customer.findMany({
          where: {
            OR: [{ name: { contains: q } }, { email: { contains: q } }],
          },
          select: { id: true, name: true, email: true },
          orderBy: { createdAt: 'desc' },
          take: MAX_RESULTS_PER_CATEGORY,
        })
      : Promise.resolve([]),
    canSee('products')
      ? prisma.product.findMany({
          where: {
            OR: [
              { name: { contains: q } },
              { sku: { contains: q } },
              ...(locale === 'ar'
                ? [{ translations: { some: { locale: 'ar', name: { contains: q } } } }]
                : []),
            ],
          },
          select: { id: true, name: true, sku: true },
          orderBy: { createdAt: 'desc' },
          take: MAX_RESULTS_PER_CATEGORY,
        })
      : Promise.resolve([]),
    canSee('inventory')
      ? prisma.supplier.findMany({
          where: {
            OR: [
              { name: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
              { contactName: { contains: q } },
            ],
          },
          select: { id: true, name: true, email: true, phone: true },
          orderBy: { updatedAt: 'desc' },
          take: MAX_RESULTS_PER_CATEGORY,
        })
      : Promise.resolve([]),
    canSee('customers')
      ? prisma.customerCase.findMany({
          where: {
            ...(branchId ? { branchId } : {}),
            OR: [
              { caseNumber: { contains: q } },
              { title: { contains: q } },
              { customer: { name: { contains: q } } },
            ],
          },
          select: { id: true, caseNumber: true, title: true, customer: { select: { name: true } } },
          orderBy: { updatedAt: 'desc' },
          take: MAX_RESULTS_PER_CATEGORY,
        })
      : Promise.resolve([]),
  ]);
  const localizedProducts = await localizeProductRows(products, locale);

  return {
    orders: orders.map((order) => ({
      id: order.id,
      title: order.orderNumber,
      subtitle: order.customer ? `${order.customer.name} — ${money(order.total)}` : money(order.total),
      href: `/admin/orders/${order.id}`,
    })),
    customers: customers.map((customer) => ({
      id: customer.id,
      title: customer.name,
      subtitle: customer.email,
      // Neither `customers` nor `products` has a single-record detail page —
      // both are edited via the resource table's Sheet, with no route of
      // their own. `?search=` is a REAL, already-wired deep link (the
      // generic resource table syncs its search box to the URL — see
      // resource-table.tsx's useUrlState call) that lands the user on the
      // filtered list with this exact row in it, not a fabricated
      // single-record URL that doesn't exist anywhere in this app.
      href: `/admin/r/customers?search=${encodeURIComponent(customer.email)}`,
    })),
    products: localizedProducts.map((product) => ({
      id: product.id,
      title: String(product.name),
      subtitle: typeof product.sku === 'string' ? product.sku : null,
      href: `/admin/r/products?search=${encodeURIComponent(
        typeof product.sku === 'string' ? product.sku : String(product.name)
      )}`,
    })),
    suppliers: suppliers.map((supplier) => ({
      id: supplier.id,
      title: supplier.name,
      subtitle: supplier.email ?? supplier.phone,
      href: `/admin/inventory/suppliers?search=${encodeURIComponent(supplier.email ?? supplier.name)}`,
    })),
    customerCases: customerCases.map((customerCase) => ({
      id: customerCase.id,
      title: customerCase.caseNumber,
      subtitle: customerCase.customer?.name ?? customerCase.title,
      href: `/admin/customer-cases?search=${encodeURIComponent(customerCase.caseNumber)}`,
    })),
  };
}
