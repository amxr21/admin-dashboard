-- Whether an order's prices already included its tax. Existing orders were
-- all taxed on top, which is what the default records.
ALTER TABLE `orders` ADD COLUMN `prices_include_tax` BOOLEAN NOT NULL DEFAULT false;
