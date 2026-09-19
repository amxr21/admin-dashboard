-- Additive: older goodwill refunds keep their original free-text Payment.note.
-- No guessed enum or fabricated Return is assigned to historical payments.
ALTER TABLE `payments`
  ADD COLUMN `refund_reason` ENUM('DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'FAULTY', 'CHANGED_MIND', 'OTHER') NULL,
  ADD COLUMN `refund_reason_note` VARCHAR(500) NULL;
