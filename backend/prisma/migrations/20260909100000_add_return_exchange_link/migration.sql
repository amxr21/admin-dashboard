-- AlterTable
ALTER TABLE `returns` ADD COLUMN `exchange_order_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `returns_exchange_order_id_key` ON `returns`(`exchange_order_id`);

-- AddForeignKey
ALTER TABLE `returns` ADD CONSTRAINT `returns_exchange_order_id_fkey` FOREIGN KEY (`exchange_order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

