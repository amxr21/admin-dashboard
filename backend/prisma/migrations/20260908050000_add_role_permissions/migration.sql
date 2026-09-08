-- CreateTable
CREATE TABLE `role_permissions` (
    `role` ENUM('DEVELOPER', 'OWNER', 'MANAGER', 'FULFILLMENT', 'CASHIER', 'SUPPORT', 'DEMO') NOT NULL,
    `areas` JSON NOT NULL,
    `updated_by_id` VARCHAR(64) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`role`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

