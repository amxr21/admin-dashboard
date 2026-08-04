-- AlterTable
ALTER TABLE `discounts` ADD COLUMN `scope` ENUM('ALL', 'CATEGORY', 'PRODUCT', 'CUSTOMER') NOT NULL DEFAULT 'ALL';

-- CreateTable
CREATE TABLE `_CategoryToDiscount` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_CategoryToDiscount_AB_unique`(`A`, `B`),
    INDEX `_CategoryToDiscount_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_CustomerToDiscount` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_CustomerToDiscount_AB_unique`(`A`, `B`),
    INDEX `_CustomerToDiscount_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_DiscountToProduct` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_DiscountToProduct_AB_unique`(`A`, `B`),
    INDEX `_DiscountToProduct_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `_CategoryToDiscount` ADD CONSTRAINT `_CategoryToDiscount_A_fkey` FOREIGN KEY (`A`) REFERENCES `categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_CategoryToDiscount` ADD CONSTRAINT `_CategoryToDiscount_B_fkey` FOREIGN KEY (`B`) REFERENCES `discounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_CustomerToDiscount` ADD CONSTRAINT `_CustomerToDiscount_A_fkey` FOREIGN KEY (`A`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_CustomerToDiscount` ADD CONSTRAINT `_CustomerToDiscount_B_fkey` FOREIGN KEY (`B`) REFERENCES `discounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_DiscountToProduct` ADD CONSTRAINT `_DiscountToProduct_A_fkey` FOREIGN KEY (`A`) REFERENCES `discounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_DiscountToProduct` ADD CONSTRAINT `_DiscountToProduct_B_fkey` FOREIGN KEY (`B`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

