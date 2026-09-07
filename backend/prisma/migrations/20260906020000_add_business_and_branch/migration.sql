-- CreateTable
CREATE TABLE `businesses` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `kind` VARCHAR(60) NULL,
    `legal_name` VARCHAR(200) NULL,
    `tax_id` VARCHAR(60) NULL,
    `email` VARCHAR(255) NULL,
    `phone` VARCHAR(40) NULL,
    `address_line` VARCHAR(255) NULL,
    `city` VARCHAR(120) NULL,
    `country` VARCHAR(2) NULL,
    `currency` VARCHAR(3) NULL,
    `timezone` VARCHAR(64) NULL,
    `logo_url` VARCHAR(512) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `businesses_is_active_idx`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branches` (
    `id` VARCHAR(191) NOT NULL,
    `business_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `code` VARCHAR(24) NULL,
    `address_line` VARCHAR(255) NULL,
    `city` VARCHAR(120) NULL,
    `phone` VARCHAR(40) NULL,
    `timezone` VARCHAR(64) NULL,
    `is_selling_point` BOOLEAN NOT NULL DEFAULT true,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `branches_business_id_is_active_idx`(`business_id`, `is_active`),
    UNIQUE INDEX `branches_business_id_code_key`(`business_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `branches` ADD CONSTRAINT `branches_business_id_fkey` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── SEED THE DEFAULT BUSINESS AND BRANCH ───────────────────────────
--
-- Every existing install has exactly one business with one location, it just
-- had no rows saying so. Creating them here means the later stages (F8.2+)
-- have something to backfill every existing product, order and movement to,
-- instead of a nullable column that would quietly stay null forever.
--
-- Fixed ids rather than generated: the backfills in later migrations need to
-- name this row, and a UUID chosen at runtime cannot be referenced from a
-- migration written today.
--
-- Guarded with NOT EXISTS so re-running against a database that already has
-- rows is a no-op rather than a duplicate-key failure.
INSERT INTO `businesses` (`id`, `name`, `is_active`, `created_at`, `updated_at`)
SELECT 'biz_default', 'My business', true, NOW(3), NOW(3)
WHERE NOT EXISTS (SELECT 1 FROM `businesses`);

INSERT INTO `branches` (`id`, `business_id`, `name`, `code`, `is_selling_point`, `is_active`, `created_at`, `updated_at`)
SELECT 'branch_default', 'biz_default', 'Main', 'MAIN', true, true, NOW(3), NOW(3)
WHERE NOT EXISTS (SELECT 1 FROM `branches`);
