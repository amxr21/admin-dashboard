-- The VAT portion of each refund, so VAT charged and VAT refunded can be
-- reported from snapshots. Existing refunds stay NULL: their VAT split was
-- never recorded, and backfilling it from today's data would fabricate it.
ALTER TABLE `returns`
  ADD COLUMN `refund_tax_amount` DECIMAL(10, 2) NULL;