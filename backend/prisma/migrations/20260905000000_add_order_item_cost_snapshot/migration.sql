-- Unit cost snapshot on the order line (F1.1).
--
-- Additive and nullable. Deliberately NOT backfilled from products.cost:
-- NULL means "cost was not recorded at sale time", which is the honest state
-- for every row written before this column existed. Backfilling from today's
-- cost would fabricate the very history this column exists to preserve.
ALTER TABLE `order_items` ADD COLUMN `cost` DECIMAL(10, 2) NULL;
