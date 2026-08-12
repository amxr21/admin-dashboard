-- CreateTable
CREATE TABLE `scheduled_reports` (
    `id` VARCHAR(191) NOT NULL,
    `report_key` VARCHAR(64) NOT NULL,
    `frequency` ENUM('DAILY', 'WEEKLY', 'MONTHLY') NOT NULL,
    `format` ENUM('CSV', 'XLSX', 'PDF') NOT NULL DEFAULT 'CSV',
    `recipients` JSON NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_run_at` DATETIME(3) NULL,
    `last_run_status` VARCHAR(16) NULL,
    `created_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `scheduled_reports_is_active_frequency_idx`(`is_active`, `frequency`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
