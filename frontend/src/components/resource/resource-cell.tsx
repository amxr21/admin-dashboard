'use client';

import { Check, ExternalLink, Minus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { StatusBadge, type StatusKind } from '@/components/status-badge';
import type { FieldConfig, ResourceRow } from '@/lib/resource-api';

/**
 * Renders one cell, chosen by the field's SEMANTIC type.
 *
 * This is the payoff of the config engine. `money` and `number` are both
 * numeric in the database, but money must never become a float and must render
 * as currency; a `datetime` must localise; a `relation` must show a name rather
 * than a cuid. Storage can't tell you any of that — meaning can.
 *
 * Every resource gets this behaviour for free, so a new one is config with no
 * new rendering code.
 */

/**
 * Enum fields that map to a translated StatusBadge namespace.
 *
 * Not every enum has one — `discount.type` (PERCENT/FIXED) is a category, not
 * a status, and giving it a tone would imply one value is healthier than the
 * other. Those render as plain text.
 */
const BADGE_KINDS: Record<string, StatusKind> = {
  deliveryStatus: 'deliveryStatus',
};

interface ResourceCellProps {
  field: FieldConfig;
  row: ResourceRow;
  /** Resource name, used to disambiguate enum fields that share a name. */
  resource: string;
}

export function ResourceCell({ field, row, resource }: ResourceCellProps) {
  const formatter = useFormatter();
  const t = useTranslations('resource');

  const value = row[field.name];

  // Null is a fact, not a blank. An em dash says "no value" where an empty
  // cell just looks like the table failed to render.
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">—</span>;
  }

  switch (field.type) {
    case 'money':
      // Formatted FROM the decimal string. Number() here is display-only and
      // never written back — see lib/resource-api.ts.
      return (
        <span className="tabular-nums">
          {formatter.number(Number(value), 'currency')}
        </span>
      );

    case 'number':
      return <span className="tabular-nums">{formatter.number(Number(value))}</span>;

    case 'boolean':
      // A tick and a dash, not "true"/"false" — and both carry a label for
      // screen readers, since shape alone is not announced.
      return value === true ? (
        <span className="text-success inline-flex items-center gap-1">
          <Check className="size-4" aria-hidden />
          <span className="sr-only">{t('yes')}</span>
        </span>
      ) : (
        <span className="text-muted-foreground inline-flex items-center gap-1">
          <Minus className="size-4" aria-hidden />
          <span className="sr-only">{t('no')}</span>
        </span>
      );

    case 'date':
    case 'datetime': {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <time dateTime={date.toISOString()} className="tabular-nums">
          {formatter.dateTime(date, field.type === 'date' ? 'short' : 'short')}
        </time>
      );
    }

    case 'enum': {
      const kind = resolveBadgeKind(resource, field.name);
      return kind ? (
        <StatusBadge kind={kind} value={String(value)} />
      ) : (
        <span>{String(value)}</span>
      );
    }

    case 'relation':
      // The engine attaches `<field>__label` alongside the raw key. Showing the
      // cuid would be unreadable, and it leaks an internal id into the UI.
      return <span>{String(row[`${field.name}__label`] ?? value)}</span>;

    case 'image':
      return (
        /*
         * Plain <img>, not next/image. Image hosts are user-supplied at
         * runtime — a store puts whatever CDN it uses in the field — and
         * next/image requires every host to be declared in next.config.ts at
         * BUILD time. A thumbnail is small enough that the optimisation isn't
         * worth making the config the limiting factor on what a user can enter.
         */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={String(value)}
          alt=""
          loading="lazy"
          className="bg-muted size-10 rounded-md object-cover"
        />
      );

    case 'email':
      return (
        // force-ltr: an address must not visually reorder inside Arabic.
        <a href={`mailto:${String(value)}`} className="force-ltr hover:underline">
          {String(value)}
        </a>
      );

    case 'phone':
      return (
        <a href={`tel:${String(value)}`} className="force-ltr hover:underline">
          {String(value)}
        </a>
      );

    case 'url':
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
        >
          <span className="force-ltr max-w-48 truncate">{String(value)}</span>
          {/* Directional: the arrow points the way out, which mirrors in RTL. */}
          <ExternalLink className="icon-directional size-3.5 shrink-0" aria-hidden />
        </a>
      );

    case 'longtext':
      return (
        <span className="text-muted-foreground line-clamp-2 max-w-xs">
          {String(value)}
        </span>
      );

    default:
      return <span>{String(value)}</span>;
  }
}

/**
 * Enum field names collide across resources — `status` means something
 * different on a product than on a review, and each has its own translations
 * and tones. Disambiguate by resource first, then fall back to the field name.
 */
function resolveBadgeKind(resource: string, fieldName: string): StatusKind | undefined {
  if (fieldName === 'status') {
    if (resource === 'products') return 'productStatus';
    if (resource === 'reviews') return 'reviewStatus';
    if (resource === 'orders') return 'orderStatus';
    return undefined;
  }

  return BADGE_KINDS[fieldName];
}
