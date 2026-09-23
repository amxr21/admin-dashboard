import { randomInt } from 'node:crypto';

import {
  DiscountScope,
  DiscountType,
  Prisma,
  ProductStatus,
  StockMovementReason,
} from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { SETTINGS } from '../config/settings.config.js';
import {
  executeIdempotently,
  type IdempotentExecution,
} from './idempotency.service.js';
import { getSettingValue } from './settings.service.js';
import type { ProductLocale } from './product-content.service.js';

/**
 * The public storefront's business logic: catalogue, cart, wishlist, checkout.
 *
 * Kept out of the routes so the rules are testable without HTTP, matching the
 * rest of `services/`. Everything here is reachable by an unauthenticated or
 * customer-authenticated caller, so two rules apply throughout:
 *
 *   1. NEVER trust a client-supplied price, total, or customer id. Prices come
 *      from the database at the moment of checkout; the customer comes from the
 *      verified token.
 *   2. NEVER return a staff-only field. The catalogue projection below is an
 *      allowlist, not a `select: *` minus a few — a column added to `Product`
 *      later must not silently start appearing on the public API.
 */

// ─── Catalogue ──────────────────────────────────────────────────────

/**
 * Public product fields. An allowlist ON PURPOSE: `Product` carries `cost`
 * (what the business pays — a competitor would love it), plus supplier-ish
 * fields like `hsCode` and `countryOfOrigin`. Selecting explicitly means a
 * future column is invisible here until someone deliberately adds it.
 */
const PUBLIC_PRODUCT_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  price: true,
  imageUrl: true,
  stock: true,
  translations: {
    select: { locale: true, name: true, description: true },
  },
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductSelect;

type PublicProductRow = Prisma.ProductGetPayload<{ select: typeof PUBLIC_PRODUCT_SELECT }>;

export interface PublicProduct {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  /** Serialised to a fixed-2 string, never a float — see the schema's money note. */
  price: string;
  image: string | null;
  /**
   * Units available right now.
   *
   * Published deliberately, so the storefront can show "Only 3 left" — that
   * urgency converts, and it is the reason this is a count rather than a
   * boolean. The trade-off is real and accepted: anyone can poll this endpoint
   * over time and derive sales volume. Do NOT extend the same treatment to
   * `cost` (margin) or supplier fields, which have no customer-facing use.
   */
  stock: number;
  /** Convenience for the common case, so the UI doesn't re-derive `stock > 0`. */
  inStock: boolean;
  category: { id: string; name: string; slug: string | null } | null;
}

/**
 * Shape a product for the public API.
 *
 * `price` is serialised with `.toFixed(2)` deliberately: Prisma returns a
 * Decimal, and letting `JSON.stringify` handle it yields an inconsistent
 * representation. A string also stops the storefront doing float arithmetic on
 * money — it has to parse it explicitly, at which point the rounding is its
 * own decision, not an accident.
 *
 * `stock` is published as a real count (see the field's own note) — clamped at
 * 0 so a negative figure from a manual correction never renders as "-2 left".
 */
function toPublicProduct(
  product: PublicProductRow,
  locale: ProductLocale = 'en',
  branchStock?: number,
): PublicProduct {
  const stock = Math.max(0, branchStock ?? product.stock);
  const translation = locale === 'en'
    ? undefined
    : product.translations.find((entry) => entry.locale === locale);

  return {
    id: product.id,
    slug: product.slug,
    name: translation?.name ?? product.name,
    description: translation?.description ?? product.description,
    price: product.price.toFixed(2),
    image: product.imageUrl,
    stock,
    inStock: stock > 0,
    category: product.category
      ? { id: product.category.id, name: product.category.name, slug: product.category.slug }
      : null,
  };
}

/**
 * Only ACTIVE products are ever public. DRAFT and ARCHIVED exist precisely so
 * staff can prepare or retire an item without it being buyable.
 */
const PUBLIC_PRODUCT_WHERE = { status: ProductStatus.ACTIVE } satisfies Prisma.ProductWhereInput;

async function requirePublicBranch(branchId: string) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, isActive: true, isSellingPoint: true, business: { isActive: true } },
    select: { id: true },
  });
  if (!branch) throw AppError.notFound('Store branch not found');
  return branch;
}

export async function listPublicBranches() {
  return prisma.branch.findMany({
    where: { isActive: true, isSellingPoint: true, business: { isActive: true } },
    select: { id: true, name: true, code: true, city: true },
    orderBy: [{ business: { name: 'asc' } }, { name: 'asc' }],
  });
}

export async function listPublicProducts(
  branchId: string,
  locale: ProductLocale = 'en',
): Promise<PublicProduct[]> {
  await requirePublicBranch(branchId);
  const products = await prisma.product.findMany({
    where: { ...PUBLIC_PRODUCT_WHERE, branchStock: { some: { branchId } } },
    select: {
      ...PUBLIC_PRODUCT_SELECT,
      branchStock: { where: { branchId }, select: { quantity: true }, take: 1 },
    },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
  });
  return products.map((product) =>
    toPublicProduct(product, locale, product.branchStock[0]?.quantity ?? 0),
  );
}

export interface PublicMenuCategory {
  id: string;
  title: string;
  slug: string | null;
  items: PublicProduct[];
}

/**
 * The catalogue grouped by category, which is how the storefront's menu page
 * renders it. Grouped here rather than client-side so ordering and naming have
 * one definition. Empty categories are omitted — a heading with nothing under
 * it reads as a bug to a shopper.
 */
export async function getPublicMenu(
  branchId: string,
  locale: ProductLocale = 'en',
): Promise<PublicMenuCategory[]> {
  await requirePublicBranch(branchId);
  const categories = await prisma.category.findMany({
    // Was unfiltered: a category switched off in the admin still appeared here
    // whenever it held an active product, so deactivating one did nothing to
    // the storefront. Deactivation is deliberate and has to be honoured.
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      products: {
        where: { ...PUBLIC_PRODUCT_WHERE, branchStock: { some: { branchId } } },
        select: {
          ...PUBLIC_PRODUCT_SELECT,
          branchStock: { where: { branchId }, select: { quantity: true }, take: 1 },
        },
        orderBy: { name: 'asc' },
      },
    },
  });

  return categories
    .filter((category) => category.products.length > 0)
    .map((category) => ({
      id: category.id,
      title: category.name,
      slug: category.slug,
      items: category.products.map((product) =>
        toPublicProduct(product, locale, product.branchStock[0]?.quantity ?? 0),
      ),
    }));
}

/** One product by slug, for the storefront's product page. */
export async function getPublicProductBySlug(
  slug: string,
  branchId: string,
  locale: ProductLocale = 'en',
): Promise<PublicProduct> {
  await requirePublicBranch(branchId);
  const product = await prisma.product.findFirst({
    where: { slug, ...PUBLIC_PRODUCT_WHERE, branchStock: { some: { branchId } } },
    select: {
      ...PUBLIC_PRODUCT_SELECT,
      branchStock: { where: { branchId }, select: { quantity: true }, take: 1 },
    },
  });

  if (!product) throw AppError.notFound('Product not found');

  return toPublicProduct(product, locale, product.branchStock[0]?.quantity ?? 0);
}

// ─── Categories ─────────────────────────────────────────────────────

/**
 * Public category fields. An allowlist for the same reason products have one.
 *
 * `parentId` is included so a storefront can rebuild the tree itself. Returned
 * FLAT rather than nested: the depth cap is 3 (see `Category.parentId`), a
 * client that wants a tree can build one from parent ids in a single pass, and
 * a nested payload would force every consumer that just wants "all categories"
 * to walk it.
 */
const PUBLIC_CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  parentId: true,
} satisfies Prisma.CategorySelect;

export interface PublicCategory {
  id: string;
  name: string;
  slug: string;
  /** Null for a top-level category. Never points at an inactive one — see below. */
  parentId: string | null;
}

/**
 * Every category a shopper may see.
 *
 * ─── `isActive` IS RESPECTED HERE, UNLIKE THE MENU ───────────────────
 * `getPublicMenu` groups products by category and never checked
 * `Category.isActive`, so a category switched off in the admin still appeared
 * on the storefront as long as it held an active product. That is fixed below
 * too — deactivating a category is a deliberate act and the public surface has
 * to honour it.
 *
 * ─── AN ORPHANED `parentId` IS NULLED, NOT LEFT DANGLING ─────────────
 * A child of a DEACTIVATED parent is still public if it is itself active. Its
 * `parentId` would then name a category absent from this response, and a
 * client building a tree would silently drop the whole subtree. Reporting it
 * as top-level is the honest answer: it IS the top of what remains visible.
 *
 * Not translated: `Category` has no translations table (only `Product` does),
 * so there is no locale parameter here. Adding one would promise a
 * localisation this schema cannot deliver.
 */
export async function listPublicCategories(): Promise<PublicCategory[]> {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    select: PUBLIC_CATEGORY_SELECT,
    orderBy: { name: 'asc' },
  });

  const visible = new Set(categories.map((category) => category.id));

  return categories.map((category) => ({
    ...category,
    parentId:
      category.parentId !== null && visible.has(category.parentId) ? category.parentId : null,
  }));
}

// ─── Discounts ──────────────────────────────────────────────────────

/**
 * The offers a shop is willing to advertise.
 *
 * ─── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────
 * `usedCount` and `maxUses` are withheld: together they say how close a code
 * is to exhaustion, which invites a race to claim the last use and tells a
 * competitor exactly how a promotion is performing.
 *
 * CUSTOMER-scoped discounts are excluded entirely. Those are targeted at named
 * people — publishing them would hand every shopper a code meant for one, and
 * leak that the targeting exists at all.
 *
 * ─── THIS DOES NOT MAKE A CODE REDEEMABLE ────────────────────────────
 * Nothing applies a discount at checkout today — `checkout()` reads prices
 * straight from the database and there is no discount service. This endpoint
 * is INFORMATIONAL: it lets a storefront display current offers. Wiring
 * redemption is separate work touching money, totals and usage counting, and
 * naming this endpoint as though it were already done would be the misleading
 * part.
 */
const PUBLIC_DISCOUNT_SELECT = {
  code: true,
  type: true,
  value: true,
  scope: true,
  expiresAt: true,
  categories: { select: { id: true, slug: true, name: true } },
  products: { select: { id: true, slug: true, name: true } },
} satisfies Prisma.DiscountSelect;

export interface PublicDiscount {
  code: string;
  type: DiscountType;
  /** Fixed-2 string like every other money/decimal value on this API. For
   *  PERCENT this is the percentage itself ("10.00" = 10%). */
  value: string;
  scope: DiscountScope;
  /** ISO timestamp, or null for an offer with no end date. */
  expiresAt: string | null;
  /** What the offer applies to. Empty for a store-wide (ALL) discount. */
  appliesTo: { id: string; slug: string | null; name: string }[];
}

export async function listPublicDiscounts(): Promise<PublicDiscount[]> {
  const now = new Date();

  const discounts = await prisma.discount.findMany({
    where: {
      isActive: true,
      // A null expiry is an offer with no end date, which is live by
      // definition — `lte`/`gte` on null would exclude it.
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      // Never CUSTOMER-scoped. Named explicitly rather than `not: CUSTOMER`
      // so a scope kind added later is invisible here until someone decides
      // it should be public.
      scope: { in: [DiscountScope.ALL, DiscountScope.CATEGORY, DiscountScope.PRODUCT] },
    },
    select: PUBLIC_DISCOUNT_SELECT,
    orderBy: { code: 'asc' },
  });

  return discounts.map((discount) => ({
    code: discount.code,
    type: discount.type,
    value: discount.value.toFixed(2),
    scope: discount.scope,
    expiresAt: discount.expiresAt?.toISOString() ?? null,
    // Only the relation the scope actually names is meaningful — see
    // `Discount.scope`'s own note. Reading all three would show a category
    // list on a PRODUCT-scoped offer just because the admin form set one.
    appliesTo:
      discount.scope === DiscountScope.CATEGORY
        ? discount.categories
        : discount.scope === DiscountScope.PRODUCT
          ? discount.products
          : [],
  }));
}

// ─── Storefront configuration ───────────────────────────────────────

export interface StorefrontConfig {
  currency: string;
  /** VAT percentage, e.g. 5 for the UAE. */
  taxRatePercent: number;
  storeName: string;
}

/**
 * The handful of settings the storefront needs to render prices correctly.
 *
 * Deliberately NOT the whole settings registry: `GET /settings` is readable by
 * any signed-in STAFF member and includes operational values (IP allowlist,
 * session timeout, maintenance mode) that a shopper has no business seeing.
 * This is an allowlist of three display values.
 *
 * Exists so the storefront never hardcodes a tax rate. A VAT figure duplicated
 * in the frontend drifts the moment someone changes it in Settings, and the
 * customer would then see a total that disagrees with what they are charged.
 */
export async function getStorefrontConfig(): Promise<StorefrontConfig> {
  const [currency, taxRate, storeName] = await Promise.all([
    getSettingValue('store.currency'),
    getSettingValue('store.taxRate'),
    getSettingValue('store.name'),
  ]);

  return {
    currency: String(currency),
    taxRatePercent: Number(taxRate),
    storeName: String(storeName),
  };
}

// ─── Cart ───────────────────────────────────────────────────────────

export interface CartLine {
  /** The CART LINE's id, not the product's — needed to address the line. */
  id: string;
  productId: string;
  slug: string | null;
  name: string;
  image: string | null;
  price: string;
  quantity: number;
  inStock: boolean;
}

export interface CartView {
  lines: CartLine[];
  /** Sum of line prices at TODAY's prices. A cart is a live intention, so this
   *  is deliberately recomputed rather than stored. */
  subtotal: string;
}

const CART_LINE_INCLUDE = {
  product: { select: PUBLIC_PRODUCT_SELECT },
} satisfies Prisma.CartItemInclude;

function toCartView(
  items: Prisma.CartItemGetPayload<{ include: typeof CART_LINE_INCLUDE }>[],
): CartView {
  const subtotal = items.reduce(
    (sum, item) => sum.plus(item.product.price.times(item.quantity)),
    new Prisma.Decimal(0),
  );

  return {
    lines: items.map((item) => ({
      id: item.id,
      productId: item.productId,
      slug: item.product.slug,
      name: item.product.name,
      image: item.product.imageUrl,
      price: item.product.price.toFixed(2),
      quantity: item.quantity,
      inStock: item.product.stock >= item.quantity,
    })),
    subtotal: subtotal.toFixed(2),
  };
}

export async function getCart(customerId: string): Promise<CartView> {
  const items = await prisma.cartItem.findMany({
    where: { customerId },
    include: CART_LINE_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });
  return toCartView(items);
}

/** Assert a product exists and is publicly buyable before it enters a cart. */
async function assertPurchasable(productId: string): Promise<void> {
  const product = await prisma.product.findFirst({
    where: { id: productId, ...PUBLIC_PRODUCT_WHERE },
    select: { id: true },
  });
  if (!product) throw AppError.badRequest('That product is not available');
}

/**
 * Add to cart, or increment an existing line.
 *
 * Uses `upsert` on the `(customerId, productId)` unique index so two rapid taps
 * become quantity 2 rather than two rows — the check-then-insert alternative
 * races with itself.
 */
export async function addToCart(
  customerId: string,
  productId: string,
  quantity: number,
): Promise<CartView> {
  await assertPurchasable(productId);

  await prisma.cartItem.upsert({
    where: { customerId_productId: { customerId, productId } },
    create: { customerId, productId, quantity },
    update: { quantity: { increment: quantity } },
  });

  return getCart(customerId);
}

/** Set an absolute quantity. Zero removes the line, which is what a quantity
 *  stepper stepped down to 0 means. */
export async function setCartQuantity(
  customerId: string,
  productId: string,
  quantity: number,
): Promise<CartView> {
  if (quantity <= 0) return removeFromCart(customerId, productId);

  await assertPurchasable(productId);

  await prisma.cartItem.upsert({
    where: { customerId_productId: { customerId, productId } },
    create: { customerId, productId, quantity },
    update: { quantity },
  });

  return getCart(customerId);
}

export async function removeFromCart(customerId: string, productId: string): Promise<CartView> {
  // deleteMany, not delete: removing an already-absent line is the caller's
  // desired end state, not an error worth a 404.
  await prisma.cartItem.deleteMany({ where: { customerId, productId } });
  return getCart(customerId);
}

// ─── Wishlist ───────────────────────────────────────────────────────

export async function getWishlist(customerId: string): Promise<PublicProduct[]> {
  const items = await prisma.wishlistItem.findMany({
    where: { customerId },
    include: { product: { select: PUBLIC_PRODUCT_SELECT } },
    orderBy: { createdAt: 'desc' },
  });
  return items.map((item) => toPublicProduct(item.product));
}

/** Toggle, so one endpoint serves both the filled and empty heart. */
export async function toggleWishlist(
  customerId: string,
  productId: string,
): Promise<{ liked: boolean }> {
  const existing = await prisma.wishlistItem.findUnique({
    where: { customerId_productId: { customerId, productId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.wishlistItem.delete({ where: { id: existing.id } });
    return { liked: false };
  }

  await assertPurchasable(productId);
  await prisma.wishlistItem.create({ data: { customerId, productId } });
  return { liked: true };
}

// ─── Checkout ───────────────────────────────────────────────────────

export interface CheckoutContact {
  name: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  note?: string;
}

export interface CheckoutInput {
  branchId: string;
  items: { productId: string; quantity: number }[];
  contact: CheckoutContact;
  paymentMethod: string;
  fulfillment: string;
  /** A discount code the shopper typed. Optional — most orders carry none. */
  discountCode?: string | undefined;
}

export interface CheckoutResult {
  orderNumber: string;
  subtotal: string;
  /** What came off, as a 2dp string. "0.00" when no code was used. */
  discountAmount: string;
  taxAmount: string;
  total: string;
}

/**
 * Resolve a typed code into money off, inside the checkout transaction.
 *
 * ─── WHY THIS RUNS IN THE TRANSACTION ────────────────────────────────
 * `maxUses` is only meaningful if the check and the increment are atomic.
 * Validating outside and incrementing inside would let two shoppers both pass
 * a check for the last remaining use — which is precisely the case `maxUses`
 * exists to prevent.
 *
 * ─── WHAT IT REFUSES, AND WITH WHICH ERROR ───────────────────────────
 * A code that is unknown, inactive, expired or not applicable is a 400: the
 * request is wrong and retrying it unchanged will fail again. A code that was
 * valid but has just been exhausted is a 409, matching how the oversell race
 * is reported — nothing is malformed, somebody else simply got there first.
 *
 * ─── CUSTOMER-SCOPED CODES ───────────────────────────────────────────
 * A CUSTOMER-scoped discount belongs to named people. A guest checkout has no
 * identity to match, so it can never redeem one — and the refusal says the
 * code does not apply rather than confirming it exists for somebody else.
 */
async function resolveDiscount(
  tx: Prisma.TransactionClient,
  code: string,
  subtotal: Prisma.Decimal,
  productIds: readonly string[],
  customerId: string | null,
): Promise<{ id: string; code: string; amount: Prisma.Decimal }> {
  const discount = await tx.discount.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      type: true,
      value: true,
      scope: true,
      isActive: true,
      expiresAt: true,
      maxUses: true,
      usedCount: true,
      categories: { select: { id: true } },
      products: { select: { id: true } },
      customers: { select: { id: true } },
    },
  });

  // One message for "no such code" and "switched off", deliberately: telling a
  // caller which one it is confirms that a code exists, which is free
  // reconnaissance for anyone guessing at them.
  if (!discount || !discount.isActive) {
    throw AppError.badRequest('That discount code is not valid', { field: 'discountCode' });
  }

  if (discount.expiresAt !== null && discount.expiresAt <= new Date()) {
    throw AppError.badRequest('That discount code has expired', { field: 'discountCode' });
  }

  if (discount.maxUses !== null && discount.usedCount >= discount.maxUses) {
    throw AppError.conflict('That discount code has been fully claimed', {
      field: 'discountCode',
    });
  }

  if (discount.scope === DiscountScope.CUSTOMER) {
    const allowed =
      customerId !== null && discount.customers.some((entry) => entry.id === customerId);
    if (!allowed) {
      throw AppError.badRequest('That discount code does not apply to this order', {
        field: 'discountCode',
      });
    }
  }

  if (discount.scope === DiscountScope.PRODUCT) {
    const eligible = new Set(discount.products.map((entry) => entry.id));
    if (!productIds.some((id) => eligible.has(id))) {
      throw AppError.badRequest('That discount code does not apply to anything in your cart', {
        field: 'discountCode',
      });
    }
  }

  if (discount.scope === DiscountScope.CATEGORY) {
    const eligible = new Set(discount.categories.map((entry) => entry.id));
    const categories = await tx.product.findMany({
      where: { id: { in: [...productIds] } },
      select: { categoryId: true },
    });
    if (!categories.some((row) => row.categoryId !== null && eligible.has(row.categoryId))) {
      throw AppError.badRequest('That discount code does not apply to anything in your cart', {
        field: 'discountCode',
      });
    }
  }

  /**
   * PERCENT reads its `value` as the percentage itself (10.00 = 10%), per the
   * schema's own note. FIXED is a money amount.
   *
   * Clamped at the subtotal: a fixed 50 off a 30 order takes 30, never 50 —
   * a negative total would be a refund the shop never agreed to, and the tax
   * line below would go negative with it.
   */
  const raw =
    discount.type === DiscountType.PERCENT
      ? subtotal.times(discount.value).dividedBy(100)
      : discount.value;

  const amount = Prisma.Decimal.min(raw, subtotal).toDecimalPlaces(2);

  /**
   * Claim the use. Conditional on the count we just read, so two checkouts
   * racing for the last use cannot both win: the loser updates zero rows.
   *
   * `updateMany` rather than `update` because it reports the row count — an
   * `update` would succeed against the stale WHERE or throw a less specific
   * error, and neither tells us we lost a race.
   */
  if (discount.maxUses !== null) {
    const claimed = await tx.discount.updateMany({
      where: { id: discount.id, usedCount: discount.usedCount },
      data: { usedCount: { increment: 1 } },
    });

    if (claimed.count === 0) {
      throw AppError.conflict('That discount code has been fully claimed', {
        field: 'discountCode',
      });
    }
  } else {
    // Uncapped: still counted, because `usedCount` is how anyone judges whether
    // a promotion worked. No guard needed — there is no limit to race for.
    await tx.discount.update({
      where: { id: discount.id },
      data: { usedCount: { increment: 1 } },
    });
  }

  return { id: discount.id, code: discount.code, amount };
}

/**
 * Alphabet for the random half of an order reference.
 *
 * Crockford-style: no I, L, O, U or 0/1. A customer reads this number off a
 * screen and says it down a phone, so glyphs that get confused with each other
 * cost support time. Excluding U also avoids accidental profanity.
 */
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const REFERENCE_LENGTH = 6;

/**
 * A cryptographically-random suffix.
 *
 * `randomInt` rather than `Math.random()`: this is a security control, and
 * `Math.random()` is a predictable PRNG — an attacker who observes a few
 * references could infer the sequence.
 *
 * Rejection-free because 30 divides evenly into randomInt's range handling;
 * `randomInt(0, n)` is already uniform, so there is no modulo bias to correct.
 */
export function randomReference(): string {
  let out = '';
  for (let i = 0; i < REFERENCE_LENGTH; i += 1) {
    out += REFERENCE_ALPHABET[randomInt(0, REFERENCE_ALPHABET.length)];
  }
  return out;
}

/** Exported for tests — the alphabet is a security property, not a detail. */
export const ORDER_REFERENCE_ALPHABET = REFERENCE_ALPHABET;

/**
 * Generate a human-facing order reference: `ORD-1024-K7M2XP`.
 *
 * ─── WHY THE RANDOM HALF EXISTS ───────────────────────────────────────
 * A purely sequential `ORD-1024` is guessable, and the tracking endpoint is
 * public. Anyone could walk `ORD-1001, ORD-1002, …` and read every customer's
 * order. The 6-character suffix gives 30^6 ≈ 729 million possibilities per
 * sequence number, so enumeration stops being viable even if the phone check
 * in `trackOrder` were ever relaxed — defence in depth, not a single gate.
 *
 * The sequential half is KEPT because staff rely on it: orders sort and read
 * chronologically in the admin list, and "order 1024" remains sayable. The
 * random half is only ever the part that has to be quoted exactly.
 *
 * Uniqueness is enforced by the unique index on `orderNumber`, not by hoping —
 * a collision (astronomically unlikely, but possible) surfaces as a failed
 * insert, and the retry loop below picks a new suffix.
 */
async function nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const latest = await tx.order.findFirst({
    // Anchored to this format so the demo dataset's `__demo__-ORD-00001`
    // references never influence the live sequence.
    where: { orderNumber: { startsWith: 'ORD-' } },
    orderBy: { createdAt: 'desc' },
    select: { orderNumber: true },
  });

  // Parse the SEQUENCE segment specifically — `ORD-1024-K7M2XP`.split gives
  // ['ORD','1024','K7M2XP'], so index 1 is the counter regardless of suffix.
  const lastSequence = latest ? Number.parseInt(latest.orderNumber.split('-')[1] ?? '', 10) : NaN;
  const next = Number.isFinite(lastSequence) ? lastSequence + 1 : 1001;

  return `ORD-${String(next)}-${randomReference()}`;
}

/**
 * Place an order. Works for guests and signed-in customers.
 *
 * The whole thing runs in ONE transaction because four writes have to agree:
 * the order, its items, the stock decrement, and the stock-movement log. A
 * partial success here means either overselling or an inventory count that no
 * longer matches its own movement history — and `stock.service.ts` has a test
 * asserting the sum of deltas equals stock, so a missing movement is a real
 * broken invariant, not just untidy data.
 *
 * Money rules, matching the schema's conventions exactly:
 *   - Prices are read from the DATABASE, never from the request. A client that
 *     posts its own price is ignored.
 *   - `OrderItem.price` snapshots today's price, so editing a product later
 *     never rewrites a historical order.
 *   - `subtotal`/`taxAmount` are snapshotted for the same reason, and `total`
 *     keeps its established meaning: the grand total, tax included. Reports and
 *     dashboard KPIs already read `.total` that way.
 */
async function checkoutOnce(
  input: CheckoutInput,
  customerId: string | null,
  tx: Prisma.TransactionClient,
  taxRate: Prisma.Decimal,
): Promise<CheckoutResult> {
  if (input.items.length === 0) {
    throw AppError.badRequest('Your cart is empty');
  }

    const branch = await tx.branch.findFirst({
      where: {
        id: input.branchId,
        isActive: true,
        isSellingPoint: true,
        business: { isActive: true },
      },
      select: { id: true },
    });
    if (!branch) {
      throw AppError.badRequest('Select an active branch', { field: 'branchId' });
    }

    // Collapse duplicate lines first: the same product twice would otherwise
    // decrement stock twice while creating two order rows for one intent.
    const quantities = new Map<string, number>();
    for (const item of input.items) {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    }

    const products = await tx.product.findMany({
      where: {
        id: { in: [...quantities.keys()] },
        ...PUBLIC_PRODUCT_WHERE,
        branchStock: { some: { branchId: input.branchId } },
      },
      select: {
        id: true,
        name: true,
        price: true,
        branchStock: {
          where: { branchId: input.branchId },
          select: { quantity: true },
          take: 1,
        },
      },
    });
    const byId = new Map(products.map((product) => [product.id, product]));

    let subtotal = new Prisma.Decimal(0);
    const lines: {
      productId: string;
      /** Carried only so the oversell conflict below can name the product. */
      name: string;
      quantity: number;
      price: Prisma.Decimal;
    }[] = [];

    for (const [productId, quantity] of quantities) {
      const product = byId.get(productId);

      // Unknown or unavailable — named generically, since the caller supplied
      // the id and doesn't need to learn whether it exists but is a draft.
      if (!product) throw AppError.badRequest('One or more items are no longer available');

      // Fails the common case early — before an order row, its items and a
      // movement log are written and then rolled back — and names the exact
      // remaining count, which the decrement below cannot report.
      const available = product.branchStock[0]?.quantity ?? 0;
      if (available < quantity) {
        throw AppError.conflict(
          `Only ${String(available)} × ${product.name} left at this branch — please adjust your cart`,
        );
      }

      subtotal = subtotal.plus(product.price.times(quantity));
      lines.push({ productId, name: product.name, quantity, price: product.price });
    }

    /**
     * A code comes off BEFORE tax.
     *
     * Taxing the full subtotal and then discounting would charge tax on money
     * the customer never paid — overstating what is owed to the tax authority
     * and disagreeing with the invoice the shopper receives.
     */
    const discount = input.discountCode
      ? await resolveDiscount(
          tx,
          input.discountCode,
          subtotal,
          [...quantities.keys()],
          customerId,
        )
      : null;

    const discountAmount = discount?.amount ?? new Prisma.Decimal(0);
    const taxable = subtotal.minus(discountAmount);

    // Rounded once, at creation, and snapshotted — same discipline as
    // OrderItem.price. A later change to store.taxRate must not reach back and
    // rewrite what this invoice already showed.
    const taxAmount = taxable.times(taxRate).toDecimalPlaces(2);
    const total = taxable.plus(taxAmount);

    const orderData = {
      total,
      subtotal,
      taxAmount,
      // Null rather than 0 when no code was used — see the column's own note on
      // why "no discount" and "a discount worth nothing" stay distinguishable.
      discountAmount: discount ? discountAmount : null,
      discountCode: discount?.code ?? null,
      discountId: discount?.id ?? null,
      paymentMethod: input.paymentMethod,
      customerId,
      branchId: input.branchId,
      items: {
        create: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          price: line.price,
        })),
      },
    };

    // Two orders placed in the same instant can draw the same sequence number,
    // and a random suffix can (astronomically rarely) repeat. Either way the
    // unique index rejects the insert — P2002 — so retry with a fresh
    // reference rather than failing a customer's checkout on a name clash.
    // Bounded: an unbounded retry on a persistent error is an infinite loop.
    let order: { id: string; orderNumber: string } | null = null;
    for (let attempt = 0; attempt < 5 && order === null; attempt += 1) {
      const orderNumber = await nextOrderNumber(tx);
      try {
        order = await tx.order.create({
          data: { ...orderData, orderNumber },
          select: { id: true, orderNumber: true },
        });
      } catch (err) {
        const isDuplicate =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        // Anything else — a bad foreign key, a lost connection — is a real
        // failure and must surface, not be retried into a confusing loop.
        if (!isDuplicate) throw err;
      }
    }

    if (order === null) {
      throw AppError.serviceUnavailable('Could not place your order — please try again');
    }

    // Contact details go on the delivery assignment's fields where they exist;
    // for now they ride along as an internal note so nothing is lost. `Order`
    // has no address column (see the assign-courier note in CLAUDE.md).
    const contactSummary = [
      `Contact: ${input.contact.name} (${input.contact.phone})`,
      input.contact.email ? `Email: ${input.contact.email}` : null,
      `Fulfillment: ${input.fulfillment}`,
      input.contact.address ? `Address: ${input.contact.address}` : null,
      input.contact.city ? `City: ${input.contact.city}` : null,
      input.contact.note ? `Note: ${input.contact.note}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    await tx.orderNote.create({
      data: { orderId: order.id, body: contactSummary, authorId: null },
    });

    // Stock: decrement AND log a movement. Both, or the "sum of deltas equals
    // stock" invariant breaks.
    //
    // The decrement is computed by the database (`stock - n`), not written back
    // from the value read above, so no update can be lost. Two simultaneous
    // checkouts for the same product contend on the row: InnoDB takes an
    // exclusive lock for the UPDATE and reads the latest committed value, so
    // the second one either waits or is aborted as a deadlock — it never
    // applies to a stale count. The P2034 branch below is that abort.
    for (const line of lines) {
      try {
        const claimed = await tx.branchStock.updateMany({
          where: {
            productId: line.productId,
            branchId: input.branchId,
            quantity: { gte: line.quantity },
          },
          data: { quantity: { decrement: line.quantity } },
        });
        if (claimed.count === 0) {
          throw AppError.conflict(
            `${line.name} just sold out at this branch — please adjust your cart and try again`,
          );
        }
      } catch (err) {
        // P2034 — write conflict / deadlock. This is the EXPECTED way to lose
        // a race for a contended product, not a bug in this code. Left
        // unmapped it surfaces to the shopper as a generic 500 and to Sentry
        // as an incident, which is wrong on both counts: nothing is broken,
        // someone else simply got there first. Mapped to the 409 the pre-flight
        // stock check already returns, so both paths look the same to the
        // storefront. Anything else is a real failure and must surface.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2034') {
          throw err;
        }
        throw AppError.conflict(
          `${line.name} just sold out at this branch — please adjust your cart and try again`,
        );
      }
      await tx.product.update({
        where: { id: line.productId },
        data: { stock: { decrement: line.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          productId: line.productId,
          branchId: input.branchId,
          delta: -line.quantity,
          reason: StockMovementReason.SOLD,
          note: `Order ${order.orderNumber}`,
          // No actorId: a customer is not staff, and the field is documented as
          // the staff member responsible. A storefront sale has none.
          actorId: null,
        },
      });
    }

    // Clear the cart only for a signed-in customer; a guest has no server cart.
    if (customerId) {
      await tx.cartItem.deleteMany({ where: { customerId } });
    }

  return {
    orderNumber: order.orderNumber,
    subtotal: subtotal.toFixed(2),
    discountAmount: discountAmount.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    total: total.toFixed(2),
  };
}

/**
 * Retry-safe public checkout.
 *
 * The idempotency claim and every order, stock and discount write share one
 * transaction. A caller that loses the first response can therefore repeat the
 * same key without creating another order or decrementing inventory twice.
 * Customer identity is part of the protected request even though it comes from
 * a verified token rather than the body: one key cannot be replayed as a
 * different shopper.
 */
export async function checkout(
  input: CheckoutInput,
  customerId: string | null,
  integrationActorId: string,
  idempotencyKey: string,
): Promise<IdempotentExecution<CheckoutResult>> {
  // Read the tax rate once before opening the transaction. A successful first
  // execution stores its exact totals, so a later retry still replays the
  // original response even if the setting changes afterward.
  const taxRateSetting = await prisma.setting.findUnique({
    where: { key: 'store.taxRate' },
    select: { value: true },
  });
  const taxRatePercent = Number(
    taxRateSetting === null ? SETTINGS['store.taxRate'].default : taxRateSetting.value,
  );
  const taxRate = new Prisma.Decimal(taxRatePercent).dividedBy(100);

  return executeIdempotently({
    scope: 'storefront.checkout',
    actorId: integrationActorId,
    key: idempotencyKey,
    request: { input, customerId },
    execute: (tx) => checkoutOnce(input, customerId, tx, taxRate),
  });
}

// ─── Order history & tracking ───────────────────────────────────────

export interface PublicOrder {
  orderNumber: string;
  status: string;
  subtotal: string | null;
  taxAmount: string | null;
  total: string;
  placedAt: Date;
  items: { name: string; quantity: number; price: string }[];
}

const PUBLIC_ORDER_SELECT = {
  orderNumber: true,
  status: true,
  subtotal: true,
  taxAmount: true,
  total: true,
  placedAt: true,
  items: {
    select: {
      quantity: true,
      price: true,
      product: { select: { name: true } },
    },
  },
} satisfies Prisma.OrderSelect;

function toPublicOrder(
  order: Prisma.OrderGetPayload<{ select: typeof PUBLIC_ORDER_SELECT }>,
): PublicOrder {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    // NULL stays null rather than becoming "0.00": the schema is explicit that
    // "never recorded" is a different fact from a confirmed zero.
    subtotal: order.subtotal ? order.subtotal.toFixed(2) : null,
    taxAmount: order.taxAmount ? order.taxAmount.toFixed(2) : null,
    total: order.total.toFixed(2),
    placedAt: order.placedAt,
    items: order.items.map((item) => ({
      // A deleted product leaves the line intact (OrderItem.productId is
      // SetNull) — show a placeholder rather than crashing on the history page.
      name: item.product?.name ?? 'Item no longer available',
      quantity: item.quantity,
      price: item.price.toFixed(2),
    })),
  };
}

/** A signed-in customer's own orders. The id comes from the token, never the URL. */
export async function getMyOrders(customerId: string): Promise<PublicOrder[]> {
  const orders = await prisma.order.findMany({
    where: { customerId },
    select: PUBLIC_ORDER_SELECT,
    orderBy: { placedAt: 'desc' },
  });
  return orders.map(toPublicOrder);
}

/**
 * Track one order without signing in.
 *
 * TWO independent controls, deliberately — defence in depth, because either one
 * alone has a failure mode:
 *
 *   1. The reference carries a 6-character random suffix (`nextOrderNumber`),
 *      so it cannot be enumerated. ~729 million possibilities per sequence
 *      number.
 *   2. The phone number the order was placed with is also required. So even a
 *      leaked or shoulder-surfed reference — a screenshot, a shared email — does
 *      not by itself expose the customer's name, address and order history.
 *
 * The phone lives in the contact note (`Order` has no phone column), so this
 * matches the customer's phone or the note body, and returns the same "not
 * found" for a wrong phone as for a missing order — confirming that a reference
 * exists is itself a small leak.
 */
export async function trackOrder(orderNumber: string, phone: string): Promise<PublicOrder> {
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: { ...PUBLIC_ORDER_SELECT, customer: { select: { phone: true } }, notes: { select: { body: true } } },
  });

  const normalise = (value: string): string => value.replace(/\D/g, '');
  const given = normalise(phone);

  const matches =
    given.length > 0 &&
    (normalise(order?.customer?.phone ?? '').endsWith(given) ||
      (order?.notes ?? []).some((note) => normalise(note.body).includes(given)));

  if (!order || !matches) {
    throw AppError.notFound('No order found with that reference and phone number');
  }

  return toPublicOrder(order);
}
