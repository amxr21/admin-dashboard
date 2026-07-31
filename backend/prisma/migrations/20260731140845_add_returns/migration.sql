-- CreateTable
CREATE TABLE `returns` (
    `id` VARCHAR(191) NOT NULL,
    `rma_number` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'REQUESTED',
    `resolution` ENUM('NONE', 'REFUND', 'STORE_CREDIT', 'REPLACEMENT') NOT NULL DEFAULT 'NONE',
    `refund_amount` DECIMAL(10, 2) NULL,
    `restocked` BOOLEAN NOT NULL DEFAULT false,
    `order_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `returns_rma_number_key`(`rma_number`),
    INDEX `returns_order_id_idx`(`order_id`),
    INDEX `returns_customer_id_idx`(`customer_id`),
    INDEX `returns_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `return_items` (
    `id` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `return_id` VARCHAR(191) NOT NULL,
    `order_item_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `return_items_return_id_idx`(`return_id`),
    INDEX `return_items_order_item_id_idx`(`order_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `returns` ADD CONSTRAINT `returns_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `returns` ADD CONSTRAINT `returns_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_items` ADD CONSTRAINT `return_items_return_id_fkey` FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_items` ADD CONSTRAINT `return_items_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

