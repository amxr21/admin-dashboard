ALTER TABLE `products` ADD COLUMN `barcode` VARCHAR(64) NULL,
    ADD COLUMN `country_of_origin` VARCHAR(2) NULL,
    ADD COLUMN `height_cm` DECIMAL(10, 2) NULL,
    ADD COLUMN `hs_code` VARCHAR(20) NULL,
    ADD COLUMN `length_cm` DECIMAL(10, 2) NULL,
    ADD COLUMN `weight_kg` DECIMAL(10, 3) NULL,
    ADD COLUMN `width_cm` DECIMAL(10, 2) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `products_barcode_key` ON `products`(`barcode`);

