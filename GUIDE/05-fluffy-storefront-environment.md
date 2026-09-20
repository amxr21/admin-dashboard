# 05 — Configure the Fluffy storefront

These values belong to the Fluffy storefront deployment, not the dashboard admin frontend.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_DATA_SOURCE` | `admin-dashboard` |
| `API_ORIGIN` | Dashboard backend origin, with no `/api/v1` suffix. Keep server-only. |
| `STOREFRONT_API_KEY` | Generated dashboard API key. Keep server-only. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same Google Web Client ID used by the dashboard. |
| `NEXT_PUBLIC_SITE_URL` | Public HTTPS URL of the Fluffy storefront. |

## Request contract

Fluffy should expose a small same-origin server route such as `/api/storefront/*`. That server route forwards approved requests to the dashboard's `/api/v1/public/*` endpoints and adds:

```http
X-API-Key: <STOREFRONT_API_KEY>
```

Create the key in **Dashboard → Settings → API keys**. Select only the areas the bridge uses: `products`, `categories`, `discounts`, and `orders`.

Never put this key in a `NEXT_PUBLIC_*` variable, client component, browser fetch, mobile bundle, or committed `.env` file. The browser calls Fluffy's same-origin route; only the Fluffy server calls the dashboard backend.

Customer authentication remains separate. Customer-owned requests send both credentials:

```http
X-API-Key: <STOREFRONT_API_KEY>
Authorization: Bearer <customer-token>
```

The API key identifies the approved storefront integration. The customer token identifies the shopper. Neither substitutes for the other.

## Example server request

```ts
const response = await fetch(`${process.env.API_ORIGIN}/api/v1/public/products/menu`, {
  headers: {
    'X-API-Key': process.env.STOREFRONT_API_KEY!,
    Accept: 'application/json',
  },
  cache: 'no-store',
});
```

For signed-in customer routes, forward the customer's bearer token in the `Authorization` header as well. Do not forward arbitrary browser-selected paths or headers; keep the bridge allowlisted.

## Failure behavior and rotation

- Missing key: `401 API key required`.
- Unknown, malformed, expired-owner, or revoked key: `401 Invalid API key`.
- Valid key without the required area scope: `403`.
- Rotate by deploying a replacement key first, verifying it, then revoking the old key. Revocation is immediate.

## Acceptance checks

- [ ] A direct request to `/api/v1/public/products` without `X-API-Key` returns `401`.
- [ ] A valid products-scoped key can read products but cannot read an unrelated area.
- [ ] Fluffy config and menu requests succeed through its server bridge.
- [ ] A signed-in customer can load their profile, cart, and orders with both credentials.
- [ ] Revoking a disposable test key makes its next request return `401`.
- [ ] No API key appears in browser source, browser network requests, or a `NEXT_PUBLIC_*` variable.
