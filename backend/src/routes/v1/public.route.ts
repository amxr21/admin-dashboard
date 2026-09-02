import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import {
  authenticateCustomer,
  optionalCustomer,
  requireCustomer,
} from '../../middleware/authenticateCustomer.js';
import { loginWithGoogle } from '../../services/customer-auth.service.js';
import {
  addToCart,
  checkout,
  getCart,
  getMyOrders,
  getPublicMenu,
  getPublicProductBySlug,
  getStorefrontConfig,
  getWishlist,
  listPublicProducts,
  removeFromCart,
  setCartQuantity,
  toggleWishlist,
  trackOrder,
} from '../../services/storefront.service.js';

/**
 * The PUBLIC storefront API, mounted at /api/v1/public.
 *
 * ─── WHY THIS ROUTER HAS NO `authenticate` ────────────────────────────
 * Every other router here mounts `authenticate` (staff) on every route. This
 * one deliberately does not: a shopper browsing a catalogue has no account, and
 * guest checkout has to work. That is safe because `authenticate` is mounted
 * PER-ROUTE in this codebase, not app-wide (see app.ts) — adding an unauthed
 * router takes nothing away from the admin surface.
 *
 * Routes that DO need a shopper use `authenticateCustomer`, which sets
 * `req.customer` and never `req.user`. Since every admin guard (`requireArea`,
 * `assertCanWrite`, the audit trail) reads `req.user`, a customer token cannot
 * satisfy one by construction rather than by a rule someone has to remember.
 *
 * ─── THE OWNERSHIP RULE ───────────────────────────────────────────────
 * No route here takes a customer id from the URL or body. `/orders` returns
 * the orders of whoever the TOKEN says you are. That is what makes an IDOR
 * impossible here rather than merely unlikely: there is no id to tamper with.
 */
export const publicRouter = Router();

/**
 * Sign-in attempts. Stricter than the general API limit and separate from the
 * staff `loginRateLimit`, so storefront traffic can never exhaust the budget
 * that protects admin login.
 */
const customerLoginRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many sign-in attempts from this address. Try again shortly.',
    },
  },
});

/**
 * Checkout. Unauthenticated by nature (guests order), so this is the only thing
 * standing between the endpoint and someone scripting thousands of orders.
 * Successful requests count — unlike login, a *successful* flood is the abuse.
 */
const checkoutRateLimit = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many orders from this address. Please try again later.',
    },
  },
});

// ─── Storefront config (no auth) ────────────────────────────────────

// Currency, tax rate and store name only — deliberately NOT the full settings
// registry, which carries staff-operational values.
publicRouter.get('/public/config', async (_req, res) => {
  res.json({ data: await getStorefrontConfig() });
});

// ─── Catalogue (no auth) ────────────────────────────────────────────

publicRouter.get('/public/products', async (_req, res) => {
  res.json({ data: await listPublicProducts() });
});

// Static path BEFORE the :slug route, or "/menu" is captured as a slug.
publicRouter.get('/public/products/menu', async (_req, res) => {
  res.json({ data: await getPublicMenu() });
});

// Lowercase letters, digits and hyphens — matches how slugs are generated and
// keeps anything path-shaped out of the lookup.
const slugParam = z
  .string()
  .min(1)
  .max(220)
  .regex(/^[a-z0-9-]+$/, 'Invalid product slug');

publicRouter.get('/public/products/:slug', async (req, res) => {
  const slug = slugParam.safeParse(req.params.slug);
  if (!slug.success) throw AppError.notFound('Product not found');

  res.json({ data: await getPublicProductBySlug(slug.data) });
});

// ─── Sign-in ────────────────────────────────────────────────────────

const loginBody = z.object({ idToken: z.string().min(10).max(4096) }).strict();

publicRouter.post('/public/auth/google', customerLoginRateLimit, async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('A Google ID token is required');

  const result = await loginWithGoogle(parsed.data.idToken);

  // Never log the token itself — it is a live credential until it expires.
  req.log.info({ event: 'storefront.login.success', customerId: result.customer.id });

  res.json({ data: result });
});

/** The signed-in shopper's own profile. */
publicRouter.get('/public/me', authenticateCustomer, (req, res) => {
  const customer = requireCustomer(req);
  res.json({
    data: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      picture: customer.picture,
    },
  });
});

// ─── Cart (customer auth) ───────────────────────────────────────────

const productIdBody = z.object({ productId: z.string().min(1).max(64) }).strict();
const addToCartBody = z
  .object({
    productId: z.string().min(1).max(64),
    // Capped: a quantity of 10,000 is a mistake or an attack, not an order.
    quantity: z.coerce.number().int().min(1).max(99).default(1),
  })
  .strict();
const setQuantityBody = z
  .object({
    productId: z.string().min(1).max(64),
    // 0 is allowed and means "remove the line".
    quantity: z.coerce.number().int().min(0).max(99),
  })
  .strict();

publicRouter.get('/public/cart', authenticateCustomer, async (req, res) => {
  res.json({ data: await getCart(requireCustomer(req).id) });
});

publicRouter.post('/public/cart', authenticateCustomer, async (req, res) => {
  const parsed = addToCartBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid cart item');

  const cart = await addToCart(
    requireCustomer(req).id,
    parsed.data.productId,
    parsed.data.quantity,
  );
  res.status(201).json({ data: cart });
});

publicRouter.patch('/public/cart', authenticateCustomer, async (req, res) => {
  const parsed = setQuantityBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid quantity');

  const cart = await setCartQuantity(
    requireCustomer(req).id,
    parsed.data.productId,
    parsed.data.quantity,
  );
  res.json({ data: cart });
});

publicRouter.delete('/public/cart', authenticateCustomer, async (req, res) => {
  const parsed = productIdBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid product');

  res.json({ data: await removeFromCart(requireCustomer(req).id, parsed.data.productId) });
});

// ─── Wishlist (customer auth) ───────────────────────────────────────

publicRouter.get('/public/wishlist', authenticateCustomer, async (req, res) => {
  res.json({ data: await getWishlist(requireCustomer(req).id) });
});

publicRouter.post('/public/wishlist', authenticateCustomer, async (req, res) => {
  const parsed = productIdBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid product');

  res.json({ data: await toggleWishlist(requireCustomer(req).id, parsed.data.productId) });
});

// ─── Checkout (guest or customer) ───────────────────────────────────

const checkoutBody = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: z.string().min(1).max(64),
            quantity: z.coerce.number().int().min(1).max(99),
          })
          .strict(),
      )
      .min(1, 'Your cart is empty')
      // Caps the transaction size — an unbounded array is an unbounded
      // transaction holding row locks.
      .max(50),
    contact: z
      .object({
        name: z.string().trim().min(1).max(200),
        phone: z.string().trim().min(4).max(48),
        email: z.string().trim().email().max(255).optional(),
        address: z.string().trim().max(500).optional(),
        city: z.string().trim().max(96).optional(),
        note: z.string().trim().max(1000).optional(),
      })
      .strict(),
    paymentMethod: z.enum(['cash', 'card-on-delivery']),
    fulfillment: z.enum(['Pickup', 'Delivery']),
  })
  .strict()
  // Delivery without an address is not a fulfillable order. Checked here rather
  // than in the service so the caller gets a field-level error.
  .refine((body) => body.fulfillment !== 'Delivery' || Boolean(body.contact.address), {
    message: 'A delivery address is required for delivery orders',
    path: ['contact', 'address'],
  });

publicRouter.post('/public/orders', checkoutRateLimit, optionalCustomer, async (req, res) => {
  const parsed = checkoutBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest(
      parsed.error.issues[0]?.message ?? 'Please check your order details',
    );
  }

  // The customer comes from the verified token or is null (guest) — never from
  // the request body.
  const result = await checkout(parsed.data, req.customer?.id ?? null);

  // Identifiers only. The contact block holds a name, phone and address, and
  // logging request bodies is how PII ends up in log aggregation forever.
  req.log.info({
    event: 'storefront.order.created',
    orderNumber: result.orderNumber,
    customerId: req.customer?.id ?? null,
  });

  res.status(201).json({ data: result });
});

// ─── Orders (history + tracking) ────────────────────────────────────

publicRouter.get('/public/orders', authenticateCustomer, async (req, res) => {
  res.json({ data: await getMyOrders(requireCustomer(req).id) });
});

const trackQuery = z.object({
  orderNumber: z.string().trim().min(2).max(40),
  // Required, not optional: the order number alone is guessable, so the phone
  // is what actually authorises the lookup.
  phone: z.string().trim().min(4).max(48),
});

publicRouter.get('/public/orders/track', async (req, res) => {
  const parsed = trackQuery.safeParse(req.query);
  if (!parsed.success) {
    throw AppError.badRequest('An order number and phone number are both required');
  }

  res.json({ data: await trackOrder(parsed.data.orderNumber, parsed.data.phone) });
});
