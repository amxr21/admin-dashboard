-- Optional scannable code per variant, unique when present.
ALTER TABLE `product_variants`
  ADD COLUMN `barcode` VARCHAR(64) NULL;
CREATE UNIQUE INDEX `product_variants_barcode_key` ON `product_variants`(`barcode`);

-- Order lines can now carry the variant that was sold, with name and code
-- snapshots so historical receipts survive a variant being renamed or deleted.
-- Existing lines stay NULL: they were never variant sales.
ALTER TABLE `order_items`
  ADD COLUMN `variant_id` VARCHAR(191) NULL,
  ADD COLUMN `variant_name` VARCHAR(120) NULL,
  ADD COLUMN `variant_sku` VARCHAR(64) NULL;
CREATE INDEX `order_items_variant_id_idx` ON `order_items`(`variant_id`);
ALTER TABLE `order_items`
  ADD CONSTRAINT `order_items_variant_id_fkey` FOREIGN KEY (`variant_id`)
  REFERENCES `product_variants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;