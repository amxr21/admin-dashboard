-- AlterTable
ALTER TABLE `return_items` ADD COLUMN `accepted_quantity` INTEGER NULL,
    ADD COLUMN `rejection_reason` VARCHAR(255) NULL,
    ADD COLUMN `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING';

