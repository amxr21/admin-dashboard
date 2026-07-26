import { setRequestLocale } from 'next-intl/server';

import { ResourceView } from '@/components/resource/resource-view';

/**
 * The generic resource page.
 *
 * `/admin/r/products`, `/admin/r/customers`, `/admin/r/discounts` — all of
 * them are this one file. The schema comes from the API at runtime, so adding
 * a resource to admin.config.ts adds a working page with no frontend change.
 *
 * Not statically generated per resource: the schema is filtered by the
 * caller's permissions, so it is genuinely per-user and must be fetched client
 * side after auth.
 */
export default async function ResourcePage({
  params,
}: {
  params: Promise<{ locale: string; resource: string }>;
}) {
  const { locale, resource } = await params;
  setRequestLocale(locale);

  return <ResourceView resource={resource} />;
}
