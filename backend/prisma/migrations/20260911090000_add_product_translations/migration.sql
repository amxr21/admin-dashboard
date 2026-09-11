CREATE TABLE `product_translations` (
    `id` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(10) NOT NULL,
    `name` VARCHAR(200) NULL,
    `description` TEXT NULL,
    `meta_title` VARCHAR(160) NULL,
    `meta_description` VARCHAR(320) NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `product_translations_locale_idx`(`locale`),
    UNIQUE INDEX `product_translations_product_id_locale_key`(`product_id`, `locale`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `product_translations`
    ADD CONSTRAINT `product_translations_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
