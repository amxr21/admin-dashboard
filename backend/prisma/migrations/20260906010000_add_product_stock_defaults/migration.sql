-- Per-product stock defaults (F7.8).
--
-- Both nullable, and NULL means "fall back", never zero:
--   low_stock_threshold NULL -> use the store-wide inventory.lowStockThreshold
--   storage_location    NULL -> not recorded
--
-- storage_location is free text on purpose. There is no Location model yet,
-- and inventing one as a side effect of adding a label would commit the schema
-- to a multi-branch design nobody has scoped. A string answers "which shelf is
-- this on" today and migrates to a relation later, since a real Location needs
-- a name anyway.
ALTER TABLE `products` ADD COLUMN `low_stock_threshold` INTEGER NULL,
    ADD COLUMN `storage_location` VARCHAR(120) NULL;
