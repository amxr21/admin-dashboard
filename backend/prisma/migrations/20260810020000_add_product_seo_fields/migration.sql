ALTER TABLE `products` ADD COLUMN `meta_description` VARCHAR(320) NULL,
    ADD COLUMN `meta_title` VARCHAR(160) NULL,
    ADD COLUMN `slug` VARCHAR(220) NULL;

-- CreateTable
CREATE TABLE `product_redirects` (
    `id` VARCHAR(191) NOT NULL,
    `old_slug` VARCHAR(220) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `product_redirects_old_slug_key`(`old_slug`),
    INDEX `product_redirects_product_id_idx`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `products_slug_key` ON `products`(`slug`);

-- AddForeignKey
ALTER TABLE `product_redirects` ADD CONSTRAINT `product_redirects_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

