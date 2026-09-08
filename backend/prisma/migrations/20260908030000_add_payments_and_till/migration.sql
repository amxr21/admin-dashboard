-- AlterTable
ALTER TABLE `shifts` ADD COLUMN `closing_count` DECIMAL(10, 2) NULL,
    ADD COLUMN `opening_float` DECIMAL(10, 2) NULL,
    ADD COLUMN `variance` DECIMAL(10, 2) NULL;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(191) NOT NULL,
    `order_id` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `method` VARCHAR(48) NOT NULL,
    `tendered` DECIMAL(10, 2) NULL,
    `change` DECIMAL(10, 2) NULL,
    `paid_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `shift_id` VARCHAR(191) NULL,
    `actor_id` VARCHAR(191) NULL,
    `reference` VARCHAR(120) NULL,
    `note` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payments_order_id_idx`(`order_id`),
    INDEX `payments_shift_id_paid_at_idx`(`shift_id`, `paid_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_shift_id_fkey` FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

