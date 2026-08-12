'use client';

import { useAppSettings } from '@/components/providers/settings-provider';

/**
 * Renders a page's `<h1>`, substituting a business-specific override for the
 * built-in translated title when one is set (Settings -> "Staff page name"
 * etc. — see settings.config.ts's "Labels" section and NAV_LABEL_KEYS in
 * settings-provider.tsx).
 *
 * The page itself stays a Server Component and passes down the ALREADY
 * TRANSLATED default title as a prop — this component only decides whether
 * to show that or the override, it does not do the translation lookup
 * itself, so it needs no locale/namespace wiring of its own.
 */
export function NavLabelHeading({
  labelKey,
  defaultTitle,
}: {
  labelKey: string;
  defaultTitle: string;
}) {
  const { navLabels } = useAppSettings();
  return <h1 className="text-2xl font-semibold">{navLabels[labelKey] ?? defaultTitle}</h1>;
}
