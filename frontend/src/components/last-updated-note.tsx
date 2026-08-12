import { useTranslations } from 'next-intl';
import { History } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Timestamp } from '@/components/timestamp';

/**
 * "Updated {when} by {who}" (C5.3) — shared shape for every mutable
 * record's detail page. Deliberately dumb: it takes an already-resolved
 * `{ when, who }` rather than fetching anything itself, because what counts
 * as "the last update" differs per record (orders combine a status-history
 * entry with an audit entry and take whichever is newer — see
 * `order-detail.tsx` — while a record with only one audit trail needs no
 * such merge), and that decision belongs to the caller, not this display.
 *
 * `who` is `null` when the acting account has since been deleted — the
 * event still happened, so it renders with an anonymous label rather than
 * disappearing. `t.rich`, not string interpolation, embeds `<Timestamp>` so
 * word order stays correct per locale instead of gluing a fixed-order
 * "{who} at {when}" together in JS.
 */
export function LastUpdatedNote({
  when,
  who,
  auditHref,
}: {
  when: string;
  who: string | null;
  /** `/admin/audit?entity=...&entityId=...` — omitted when no audit trail exists yet for this record. */
  auditHref?: string;
}) {
  const t = useTranslations('lastUpdated');
  const time = () => <Timestamp value={when} />;

  const content = (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
      {auditHref ? <History aria-hidden className="size-3.5" /> : null}
      {who ? t.rich('updatedByAt', { who, time }) : t.rich('updatedAtUnknownActor', { time })}
    </span>
  );

  if (!auditHref) return content;

  return (
    <Link
      href={auditHref}
      className="hover:text-foreground w-fit rounded-sm underline-offset-4 hover:underline"
    >
      {content}
    </Link>
  );
}
