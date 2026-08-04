-- AlterTable
ALTER TABLE `customers` ADD COLUMN `internal_notes` TEXT NULL;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `internal_notes` TEXT NULL;
