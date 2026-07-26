import { getTranslations } from 'next-intl/server';

import { ErrorScreen } from '@/components/errors/error-screen';

/**
 * Shown when a route does not exist, or when a page calls `notFound()`.
 *
 * Deliberately says nothing about "404". The visitor cannot act on a status
 * code — they can act on "this page doesn't exist, here's the way back".
 */
export default async function NotFound() {
  const t = await getTranslations('errorPages.notFound');

  return <ErrorScreen title={t('title')} description={t('description')} />;
}
