-- Preserve existing behaviour: before this column every product was taxed at
-- the store rate, so all existing and new products start taxable.
ALTER TABLE `products`
  ADD COLUMN `is_taxable` BOOLEAN NOT NULL DEFAULT true;

-- Historical order lines keep NULL: their authoritative tax is the amount
-- already snapshotted on the order, and backfilling a line-level fact would
-- fabricate detail that was never recorded.
ALTER TABLE `order_items`
  ADD COLUMN `is_taxable` BOOLEAN NULL;
