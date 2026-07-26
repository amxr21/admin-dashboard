import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/**
 * Locale-aware navigation primitives.
 *
 * Import `Link`, `useRouter`, `usePathname` and `redirect` FROM HERE, never
 * from `next/link` or `next/navigation` directly. These wrappers carry the
 * active locale automatically.
 *
 * Using the raw Next.js versions is the most common i18n bug: a plain
 * `<Link href="/orders">` drops an Arabic user back to English, and it does so
 * silently — the link works, it just changes language.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
