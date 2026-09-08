-- AlterTable
ALTER TABLE `stock_movements` ADD COLUMN `delivered_at` DATETIME(3) NULL,
    ADD COLUMN `purchased_at` DATETIME(3) NULL,
    ADD COLUMN `reference` VARCHAR(64) NULL,
    ADD COLUMN `supplier_id` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `email` VARCHAR(255) NULL,
    `phone` VARCHAR(40) NULL,
    `contact_name` VARCHAR(160) NULL,
    `note` VARCHAR(255) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `suppliers_is_active_idx`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `stock_movements_supplier_id_idx` ON `stock_movements`(`supplier_id`);

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

