import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NotificationsList } from '@/components/notifications/notifications-list';

/**
 * The full notifications list. Not in the sidebar — the bell (top bar) is
 * the one entry point, same reasoning as the generic `/admin/r/notifications`
 * page it replaces: a notification count changes while you work and needs to
 * be visible everywhere, which a nav group buried behind a click is not.
 */
export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('notificationsBell');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
      </div>

      <NotificationsList />
    </div>
  );
}
