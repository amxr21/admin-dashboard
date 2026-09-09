-- AlterTable
ALTER TABLE `categories` ADD COLUMN `parent_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `categories_parent_id_idx` ON `categories`(`parent_id`);

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
