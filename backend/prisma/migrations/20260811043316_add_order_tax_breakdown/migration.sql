-- AlterTable
ALTER TABLE `orders` ADD COLUMN `subtotal` DECIMAL(10, 2) NULL,
    ADD COLUMN `tax_amount` DECIMAL(10, 2) NULL;
