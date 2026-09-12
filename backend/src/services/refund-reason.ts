import { RefundReason } from '@prisma/client';

import { AppError } from '../errors/AppError.js';

/** One staff-selected catalogue reason, with free text only for OTHER. */
export function assertRefundReason(input: {
  refundReason?: RefundReason | undefined;
  refundReasonNote?: string | undefined;
}): { refundReason: RefundReason; refundReasonNote: string | null } {
  const reason = input.refundReason;
  if (!reason || !Object.values(RefundReason).includes(reason)) {
    throw AppError.badRequest('Choose why this refund is being given', {
      field: 'refundReason',
    });
  }

  const note = input.refundReasonNote?.trim() || null;
  if (reason === RefundReason.OTHER && !note) {
    throw AppError.badRequest('Describe the refund reason', { field: 'refundReasonNote' });
  }
  if (reason !== RefundReason.OTHER && note) {
    throw AppError.badRequest('A reason note only applies to "Other"', {
      field: 'refundReasonNote',
    });
  }

  return { refundReason: reason, refundReasonNote: note };
}
