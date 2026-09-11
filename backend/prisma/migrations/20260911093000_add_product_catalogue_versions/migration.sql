ALTER TABLE `products`
    ADD COLUMN `catalogue_version` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `product_catalogue_versions` (
    `id` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `source` VARCHAR(24) NOT NULL,
    `summary` VARCHAR(255) NOT NULL,
    `snapshot` JSON NOT NULL,
    `actor_id` VARCHAR(191) NULL,
    `actor_email` VARCHAR(320) NULL,
    `actor_role` VARCHAR(32) NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `product_catalogue_versions_product_id_version_key`(`product_id`, `version`),
    INDEX `product_catalogue_versions_product_id_created_at_idx`(`product_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `product_catalogue_versions`
    ADD CONSTRAINT `product_catalogue_versions_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
