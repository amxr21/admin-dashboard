/** Stable backend codes shared by return-based and goodwill refunds. */
export const REFUND_REASONS = [
  'DAMAGED',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'FAULTY',
  'CHANGED_MIND',
  'OTHER',
] as const;

export type RefundReason = (typeof REFUND_REASONS)[number];
