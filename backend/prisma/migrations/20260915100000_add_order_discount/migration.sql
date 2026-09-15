-- What was taken off an order, and why.
--
-- Three nullable columns, no backfill. NULL means "no discount", which is a
-- different fact from a recorded 0.00 — a code that resolved to nothing off is
-- a real event worth telling apart from an order nobody discounted.
--
-- `discount_code` and `discount_id` are BOTH nullable and independently so:
--   - a storefront redemption has both
--   - an admin granting a discount by hand has neither a code nor a catalogue
--     row, and that is an ordinary case the schema has to hold without a
--     second migration later
--
-- `discount_id` is a plain id rather than a foreign key, matching `branch_id`
-- on this same table: the record of what a customer was charged must survive
-- the Discount row being edited or removed.

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `discount_amount` DECIMAL(10, 2) NULL,
    ADD COLUMN `discount_code` VARCHAR(48) NULL,
    ADD COLUMN `discount_id` VARCHAR(64) NULL;
