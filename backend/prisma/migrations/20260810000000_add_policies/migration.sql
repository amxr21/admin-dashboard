-- CreateTable
CREATE TABLE `policy` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('RETURN', 'PRIVACY', 'TERMS', 'SHIPPING') NOT NULL,
    `locale` VARCHAR(8) NOT NULL,
    `published_version_id` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `policy_published_version_id_key`(`published_version_id`),
    UNIQUE INDEX `policy_type_locale_key`(`type`, `locale`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `policy_version` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('RETURN', 'PRIVACY', 'TERMS', 'SHIPPING') NOT NULL,
    `locale` VARCHAR(8) NOT NULL,
    `version` INTEGER NOT NULL,
    `content` TEXT NOT NULL,
    `created_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `policy_version_type_locale_created_at_idx`(`type`, `locale`, `created_at`),
    UNIQUE INDEX `policy_version_type_locale_version_key`(`type`, `locale`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `policy` ADD CONSTRAINT `policy_published_version_id_fkey` FOREIGN KEY (`published_version_id`) REFERENCES `policy_version`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

