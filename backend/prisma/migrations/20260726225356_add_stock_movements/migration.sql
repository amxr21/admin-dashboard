-- CreateTable
CREATE TABLE `stock_movements` (
    `id` VARCHAR(191) NOT NULL,
    `delta` INTEGER NOT NULL,
    `reason` ENUM('RECEIVED', 'SOLD', 'DAMAGED', 'LOST', 'RETURNED', 'CORRECTION') NOT NULL,
    `note` VARCHAR(255) NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `actor_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_movements_product_id_created_at_idx`(`product_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
