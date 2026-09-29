import type { Request } from 'express';

/**
 * Marks a middleware as an AREA GUARD — one that checks the caller against a
 * permission area and, for an API key, against the key's scopes (see
 * `requireArea`).
 *
 * ─── WHY A MARK ────────────────────────────────────────────────────────
 * A key's scopes are enforced inside the area check and nowhere else. A route
 * guarded some other way — a role check, a hand-rolled test in the handler, or
 * nothing past `authenticate` — would let a SCOPED key through with its
 * owner's full rights: a key narrowed to `products` could read settings, list
 * customers, or mint itself an unscoped key.
 *
 * So `authenticate` refuses a scoped key on any route whose middleware stack
 * holds no marked guard. The default for a new route is therefore "scoped keys
 * cannot reach it", and adding `requireArea` is what opens it — the safe
 * direction to fail in.
 */
const AREA_GUARD = Symbol('areaGuard');

type Marked = { [AREA_GUARD]?: true };

export function markAreaGuard<T extends (...args: never[]) => unknown>(guard: T): T {
  (guard as T & Marked)[AREA_GUARD] = true;
  return guard;
}

/**
 * Whether the route being dispatched declares an area guard.
 *
 * Reads Express's own route record: while a route's middleware runs,
 * `req.route.stack` lists every handler of that route. A middleware mounted
 * with `router.use()` runs outside any route, so there is no route record and
 * the answer is `false` — a scoped key is refused there too.
 */
export function routeHasAreaGuard(req: Request): boolean {
  const route = req.route as { stack?: { handle?: unknown }[] } | undefined;
  return (route?.stack ?? []).some(
    (layer) => typeof layer.handle === 'function' && (layer.handle as Marked)[AREA_GUARD] === true,
  );
}
