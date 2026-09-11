import { MAX_RANGE_DAYS, defaultRange, type DateRange } from '@/lib/reports-api';

export type DashboardComparison = 'previous' | 'sameLastYear' | 'none';

export const DEFAULT_DASHBOARD_COMPARISON: DashboardComparison = 'previous';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COMPARISONS = new Set<DashboardComparison>(['previous', 'sameLastYear', 'none']);

function parseDate(value: string | undefined): Date | null {
  if (!value || !DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year!, month! - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month! - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function validRange(from: string | undefined, to: string | undefined): DateRange | null {
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  if (!fromDate || !toDate || fromDate > toDate) return null;

  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  return days <= MAX_RANGE_DAYS ? { from: from!, to: to! } : null;
}

export interface DashboardState {
  range: DateRange;
  comparison: DashboardComparison;
  /** True when supplied dashboard params do not describe the rendered state. */
  needsNormalization: boolean;
}

export function parseDashboardState(values: Record<string, string | undefined>): DashboardState {
  const suppliedRange = Boolean(values.from || values.to);
  const range = validRange(values.from, values.to) ?? defaultRange();
  const comparison = COMPARISONS.has(values.comparison as DashboardComparison)
    ? (values.comparison as DashboardComparison)
    : DEFAULT_DASHBOARD_COMPARISON;

  return {
    range,
    comparison,
    needsNormalization:
      (suppliedRange && validRange(values.from, values.to) === null) ||
      Boolean(values.comparison && !COMPARISONS.has(values.comparison as DashboardComparison)),
  };
}

export function rangeToDashboardParams(range: DateRange): Record<'from' | 'to', string | null> {
  const fallback = defaultRange();
  const isDefault = range.from === fallback.from && range.to === fallback.to;
  return { from: isDefault ? null : range.from, to: isDefault ? null : range.to };
}
