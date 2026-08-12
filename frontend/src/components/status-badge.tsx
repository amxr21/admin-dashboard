'use client';

import { useTranslations } from 'next-intl';

import { Badge, type BadgeProps } from '@/components/ui/badge';

/**
 * Renders a DB enum value as a translated, tone-mapped badge.
 *
 * This is the ONE place enum → colour and enum → label live. Without it, every
 * table decides its own mapping and `DELIVERED` ends up green in one view and
 * grey in another — and someone eventually renders the raw `SCREAMING_CASE`
 * value to a user.
 *
 * The value stays English in the database. Only the label is translated.
 */

type Tone = NonNullable<BadgeProps['variant']>;

/**
 * Tone per status.
 *
 * Chosen by MEANING, not by aesthetics: a terminal-good state is success, an
 * in-progress state is info, a waiting state is warning, a failed or reversed
 * state is destructive. Getting this wrong makes a table lie at a glance,
 * which is the whole reason people scan colour instead of reading.
 */
const TONES = {
  orderStatus: {
    PENDING: 'warning',
    CONFIRMED: 'info',
    SHIPPED: 'info',
    DELIVERED: 'success',
    CANCELED: 'destructive',
    // Not destructive: a return is a normal, completed business outcome, not
    // an error. Colouring it red makes healthy returns look like failures.
    RETURNED: 'muted',
  },
  productStatus: {
    DRAFT: 'muted',
    ACTIVE: 'success',
    ARCHIVED: 'secondary',
  },
  reviewStatus: {
    PENDING: 'warning',
    APPROVED: 'success',
    REJECTED: 'destructive',
  },
  deliveryStatus: {
    ASSIGNED: 'muted',
    PICKED_UP: 'info',
    OUT_FOR_DELIVERY: 'info',
    DELIVERED: 'success',
    HANDED_OVER: 'success',
    // Re-triable, not a terminal error, but still a failure at a glance —
    // distinct from the in-progress 'info' tones above.
    FAILED_ATTEMPT: 'destructive',
  },
  deliveryStaffStatus: {
    ACTIVE: 'success',
    ON_SHIFT: 'info',
    INACTIVE: 'muted',
  },
  returnStatus: {
    REQUESTED: 'warning',
    APPROVED: 'success',
    REJECTED: 'destructive',
  },
  returnResolution: {
    NONE: 'muted',
    REFUND: 'info',
    STORE_CREDIT: 'secondary',
    REPLACEMENT: 'secondary',
  },
  // Informational grouping only — unlike order/return STATUS, no category
  // here means "problem" or "success"; one neutral tone for all six avoids
  // implying DAMAGED is worse than NO_LONGER_NEEDED.
  returnCategory: {
    DAMAGED: 'muted',
    WRONG_ITEM: 'muted',
    NOT_AS_DESCRIBED: 'muted',
    NO_LONGER_NEEDED: 'muted',
    ARRIVED_LATE: 'muted',
    OTHER: 'muted',
  },
  auditOutcome: {
    // Muted, not success: an ordinary recorded change is the baseline, and
    // colouring every row green would drown the handful that matter.
    SUCCESS: 'muted',
    // The one value a security reviewer is scanning for.
    DENIED: 'destructive',
    ERROR: 'warning',
  },
  roles: {
    DEVELOPER: 'info',
    OWNER: 'default',
    MANAGER: 'secondary',
    FULFILLMENT: 'secondary',
    SUPPORT: 'secondary',
    // Visually distinct on purpose — anyone looking at a staff list should be
    // able to tell instantly that an account cannot write.
    DEMO: 'warning',
  },
} as const satisfies Record<string, Record<string, Tone>>;

export type StatusKind = keyof typeof TONES;

interface StatusBadgeProps {
  /** Which enum this value belongs to — selects both tone map and namespace. */
  kind: StatusKind;
  /** The raw English value from the API, e.g. "DELIVERED". */
  value: string;
  className?: string;
}

export function StatusBadge({ kind, value, className }: StatusBadgeProps) {
  const t = useTranslations(kind);

  const tones = TONES[kind] as Record<string, Tone | undefined>;
  // Unknown value → neutral tone rather than a crash. An enum added to the API
  // before the frontend knows about it should degrade, not break the page.
  const tone = tones[value] ?? 'muted';

  // `t.has()` rather than try/catch: next-intl does NOT throw on a missing
  // key — it logs and returns the full key path ("orderStatus.FOO"), so a
  // catch block never fires and the user sees a dotted path instead of a
  // label. Checking first is the only reliable fallback.
  const label = t.has(value) ? t(value) : value;

  return (
    <Badge variant={tone} className={className}>
      {label}
    </Badge>
  );
}
