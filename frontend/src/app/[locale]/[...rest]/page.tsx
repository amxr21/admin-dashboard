import { notFound } from 'next/navigation';

/**
 * Catch-all inside the locale segment, so unmatched URLs reach OUR not-found
 * page instead of Next's default one.
 *
 * Without this file, `/admin/orders` (or any typo) matches no route, Next
 * falls back to its own built-in "404 — This page could not be found", and
 * `[locale]/not-found.tsx` never renders. The built-in page has no translation,
 * no layout, no way back, and shows a bare status code — everything the error
 * screens exist to avoid.
 *
 * This is the documented next-intl pattern for `localePrefix: 'as-needed'`:
 * the middleware rewrites into `[locale]`, so the catch-all has to live here
 * rather than at the app root.
 */
export default function CatchAllNotFound() {
  notFound();
}
