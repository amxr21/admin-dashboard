-- CreateTable
CREATE TABLE `till_events` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('NO_SALE', 'CASH_DROP', 'PAYOUT') NOT NULL,
    `amount` DECIMAL(10, 2) NULL,
    `note` VARCHAR(255) NULL,
    `shift_id` VARCHAR(191) NOT NULL,
    `actor_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `till_events_shift_id_created_at_idx`(`shift_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `till_events` ADD CONSTRAINT `till_events_shift_id_fkey` FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
