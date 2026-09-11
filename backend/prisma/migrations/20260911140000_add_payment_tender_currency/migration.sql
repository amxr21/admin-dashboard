-- Multi-currency tender at the till.
--
-- Additive and nullable on purpose. NULL means "taken before this column
-- existed", which is a different fact from "taken in the base currency" —
-- inventing a currency for historical rows is exactly the drift these
-- columns exist to prevent.
--
-- `tender_rate` is a SNAPSHOT of the rate used at the moment of sale, not a
-- foreign key to a rates table. Editing the configured rate later must never
-- rewrite what a past receipt claims, the same discipline `order_items.cost`
-- and `orders.total` already follow.
ALTER TABLE `payments`
  ADD COLUMN `tender_currency` VARCHAR(3) NULL,
  ADD COLUMN `tender_amount` DECIMAL(10, 2) NULL,
  ADD COLUMN `tender_rate` DECIMAL(18, 8) NULL;
