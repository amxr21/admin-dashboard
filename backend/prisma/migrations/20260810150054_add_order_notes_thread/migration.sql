/*
  Warnings:

  - You are about to drop the column `internal_notes` on the `orders` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `orders` DROP COLUMN `internal_notes`;

-- CreateTable
CREATE TABLE `order_notes` (
    `id` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `author_id` VARCHAR(191) NULL,
    `order_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_notes_order_id_created_at_idx`(`order_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `order_notes` ADD CONSTRAINT `order_notes_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
