# Admin and Storefront Integration Guide

This guide explains how to operate one brand across one or many branches, connect a storefront safely, and diagnose common API errors without developer assistance. The dashboard also includes an interactive bilingual version under **Guide → Detailed checklists**.

## 1. The model in one minute

- A **brand/business** owns the catalogue, staff, settings, and branches.
- A **branch** is a physical location or selling point with its own timezone and stock.
- One public website can represent the whole brand.
- The website first loads active branches, asks the shopper to select one (or chooses a configured default), and sends that branch ID with catalogue and checkout requests.
- `X-API-Key` identifies the approved storefront integration. It is not a staff login and not a shopper login.
- A shopper JWT in `Authorization: Bearer ...` is separate and is required only for customer-specific data such as cart, wishlist, profile, and order history.

## 2. Critical security rule

An API key is a password. Never place it in browser JavaScript, screenshots, chat, tickets, source control, or public environment variables.

If a key is ever exposed:

1. Revoke it in the dashboard immediately.
2. Create a replacement with only the required scopes.
3. Store the replacement only in the storefront server's secret environment variables.
4. Redeploy the storefront server.
5. Confirm the old key receives `401`.
6. Review audit and login history for suspicious activity.

The key previously pasted into a chat must be treated as exposed and replaced. Do not reuse it.

## 3. Request authentication

Every `/api/v1/public/*` request requires:

```http
X-API-Key: <server-side integration key>
Accept-Language: en
```

Use `Accept-Language: ar` for Arabic product content. The header must not include quotes.

Customer-only routes additionally require:

```http
Authorization: Bearer <customer JWT returned by storefront sign-in>
```

The two credentials have different purposes:

| Credential | Identifies | Where it belongs | Used for |
|---|---|---|---|
| `X-API-Key` | The storefront integration | Storefront server only | Every public API request |
| Customer Bearer token | The signed-in shopper | Secure customer session | Profile, cart, wishlist, order history |

## 4. Why `GET /public/orders` returned “Please sign in”

`GET /api/v1/public/orders` is the signed-in customer's private order history. An API key authorizes the storefront application, but it does not identify which customer owns the orders. The endpoint therefore also requires the customer's Bearer token.

Use the correct route for the task:

- Create a guest or customer order: `POST /api/v1/public/orders`
- Read the signed-in customer's history: `GET /api/v1/public/orders` plus customer Bearer token
- Track one order without signing in: `GET /api/v1/public/orders/track?orderNumber=...&phone=...`
- Read products: `GET /api/v1/public/products?branchId=...`

## 5. One website for the whole brand

Use one website and make branch selection part of the shopping session.

1. Call `GET /api/v1/public/branches`.
2. If one branch is available, select it automatically.
3. If several branches are available, let the shopper choose by name/location.
4. Save the selected branch ID in the shopper session or cookie.
5. Include `branchId` on every product/menu/detail request.
6. Include the same `branchId` in checkout.
7. When the shopper switches branches, reload the catalogue and revalidate the cart because price or stock availability may differ.

The API key is normally shared by the brand website. It does not replace branch selection. The branch ID determines which location's sellable stock and local operating context are used.

## 6. Recommended server-side architecture

```text
Shopper browser
    ↓ calls your website only
Brand website / server route
    ↓ adds X-API-Key from a secret environment variable
Admin Dashboard public API
```

Do not call the public API directly from browser code when doing so would reveal `X-API-Key`. Create same-origin server routes or server actions in the storefront and proxy the minimum required request.

Example server-side request:

```ts
const response = await fetch(
  `${process.env.ADMIN_API_URL}/api/v1/public/products?branchId=${encodeURIComponent(branchId)}`,
  {
    headers: {
      'X-API-Key': process.env.ADMIN_STOREFRONT_API_KEY!,
      'Accept-Language': locale === 'ar' ? 'ar' : 'en',
    },
    cache: 'no-store',
  },
);

if (!response.ok) {
  const problem = await response.json();
  throw new Error(`Catalogue request failed: ${response.status} ${problem?.error?.code ?? ''}`);
}
```

## 7. Postman tests

### List branches

```http
GET https://api.admin-dashboard.amxr.site/api/v1/public/branches
X-API-Key: <replacement-key>
Accept-Language: en
```

Copy an active branch's `id` from the response.

### List products for a branch

```http
GET https://api.admin-dashboard.amxr.site/api/v1/public/products?branchId=<branch-id>
X-API-Key: <replacement-key>
Accept-Language: en
```

### Get the branch menu

```http
GET https://api.admin-dashboard.amxr.site/api/v1/public/products/menu?branchId=<branch-id>
X-API-Key: <replacement-key>
Accept-Language: ar
```

### Create a guest order

```http
POST https://api.admin-dashboard.amxr.site/api/v1/public/orders
Content-Type: application/json
X-API-Key: <replacement-key>
Accept-Language: en

{
  "branchId": "<branch-id>",
  "items": [
    { "productId": "<product-id>", "quantity": 1 }
  ],
  "contact": {
    "name": "Test Customer",
    "phone": "+971500000000",
    "email": "customer@example.com",
    "address": "Test address",
    "city": "Dubai"
  },
  "paymentMethod": "cash",
  "fulfillment": "Delivery"
}
```

For `Delivery`, `contact.address` is required. Supported payment methods are `cash` and `card-on-delivery`; supported fulfillment values are `Pickup` and `Delivery`.

### Read signed-in order history

```http
GET https://api.admin-dashboard.amxr.site/api/v1/public/orders
X-API-Key: <replacement-key>
Authorization: Bearer <customer-token>
Accept-Language: en
```

## 8. Public endpoint reference

| Method | Route | Branch required | Customer token required |
|---|---|---:|---:|
| GET | `/public/config` | No | No |
| GET | `/public/branches` | No | No |
| GET | `/public/products?branchId=...` | Yes | No |
| GET | `/public/products/menu?branchId=...` | Yes | No |
| GET | `/public/products/:slug?branchId=...` | Yes | No |
| GET | `/public/categories` | No | No |
| GET | `/public/discounts` | No | No |
| POST | `/public/auth/google` | No | No |
| GET | `/public/me` | No | Yes |
| GET/POST/PATCH/DELETE | `/public/cart` | No | Yes |
| GET/POST | `/public/wishlist` | No | Yes |
| POST | `/public/orders` | In JSON body | Optional |
| GET | `/public/orders` | No | Yes |
| GET | `/public/orders/track?orderNumber=...&phone=...` | No | No |

All routes in this table still require `X-API-Key`.

## 9. Troubleshooting

| Result | Meaning | What to check |
|---|---|---|
| `400 Choose a store branch` | `branchId` is missing or invalid | Use an active ID returned by `/public/branches` |
| `401 API key required` | `X-API-Key` was not sent | Check the exact header name and the server secret |
| `401 Invalid API key` | Key is wrong, revoked, malformed, or owner is inactive | Create a replacement and confirm the account is active |
| `401 Please sign in` | Route needs a customer token | Add `Authorization: Bearer <customer-token>` or use a guest-capable route |
| `403` | Owner permission or key scope does not allow the area | Grant only the needed products/categories/orders scope |
| `404` | Branch/product is unavailable in this context | Check active branch, active product, slug, and branch stock membership |
| `429` | Rate limit reached | Stop immediate retries and use bounded exponential backoff |

Keep the response `requestId` when reporting an error; it is the safest way to correlate the request with server logs without sharing private request bodies.

## 10. Administrator checklists

### Initial setup

- [ ] Real Owner account is active.
- [ ] Brand name, logo, contact details, locale, currency, and tax are verified.
- [ ] Privileged users have individual accounts and two-factor authentication.
- [ ] Notification recipients are configured and tested.
- [ ] Temporary credentials and operator ownership are removed when no longer needed.

### Each branch

- [ ] Branch name/code is unique and correct.
- [ ] Local timezone is correct.
- [ ] Branch is active and intended to sell publicly.
- [ ] Staff are assigned to the correct branch and least-privileged role.
- [ ] Branch stock records exist for every sellable product.
- [ ] Opening quantities were recorded through traceable stock movements.
- [ ] A test sale verifies catalogue, checkout, stock reduction, receipt, and daily report.

### Catalogue readiness

- [ ] Categories are visible and correctly organized.
- [ ] Products are `ACTIVE` and have valid prices.
- [ ] Product names and descriptions are reviewed in English and Arabic.
- [ ] Images have descriptive alternative text.
- [ ] Every sellable product has branch stock membership.
- [ ] Out-of-stock behavior matches the storefront design.

### API and storefront launch

- [ ] Any exposed key was revoked.
- [ ] Replacement key has a clear recipient/environment name.
- [ ] Key scopes are limited to the routes the storefront uses.
- [ ] Key is stored only in server-side secret storage.
- [ ] `/public/branches` succeeds.
- [ ] English and Arabic catalogue requests succeed for every active branch.
- [ ] Guest checkout succeeds for Pickup and Delivery.
- [ ] Signed-in profile, cart, wishlist, and order history succeed with a customer token.
- [ ] Branch switching reloads catalogue and revalidates cart contents.
- [ ] Error and rate-limit states show safe, understandable messages.

### Daily opening

- [ ] Correct branch is selected.
- [ ] Shift and cash drawer state are correct.
- [ ] POS, printer, scanner, and network are ready.
- [ ] Critical stock and low-stock alerts were reviewed.
- [ ] A known product can be found and added to an order.

### Daily closing

- [ ] Open orders, deliveries, returns, and parked sales are resolved or handed over.
- [ ] Cash matches the shift record.
- [ ] Shift is closed with the correct branch and timestamp.
- [ ] Exceptions are documented using request/order IDs, not sensitive customer data.
- [ ] Daily report is reviewed in the branch's local timezone.

### Incident response

- [ ] Contain the affected account, key, session, or branch.
- [ ] Revoke exposed credentials and issue minimally scoped replacements.
- [ ] Preserve request IDs, timestamps, and audit records.
- [ ] Do not paste tokens, customer details, or full request bodies into tickets.
- [ ] Verify recovery with a safe acceptance test.
- [ ] Record the cause and prevention action.

### Production release

- [ ] Changes are committed and reviewed in a pull request.
- [ ] Lint, typecheck, tests, and production builds pass.
- [ ] English, Arabic, LTR, RTL, keyboard, and mobile layouts are checked.
- [ ] Database migrations are reviewed and a restorable backup exists.
- [ ] Branch-by-branch acceptance tests pass.
- [ ] Monitoring, rollback owner, and rollback steps are ready.
