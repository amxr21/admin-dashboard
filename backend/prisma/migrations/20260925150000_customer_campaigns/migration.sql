-- Customer outreach campaigns: per-channel marketing consent on customers
-- (default false: an order contact is not a marketing opt-in), campaigns,
-- their recipients (unique per campaign+customer: the duplicate-send guard)
-- and a suppression list checked at audience and send time.

-- AlterTable
ALTER TABLE `customers` ADD COLUMN `email_consent_at` DATETIME(3) NULL,
    ADD COLUMN `email_consent_source` VARCHAR(40) NULL,
    ADD COLUMN `email_marketing_consent` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `sms_consent_at` DATETIME(3) NULL,
    ADD COLUMN `sms_consent_source` VARCHAR(40) NULL,
    ADD COLUMN `sms_marketing_consent` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `campaigns` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `channel` ENUM('EMAIL', 'SMS') NOT NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELED', 'FAILED') NOT NULL DEFAULT 'DRAFT',
    `subject_en` VARCHAR(200) NULL,
    `subject_ar` VARCHAR(200) NULL,
    `body_en` TEXT NULL,
    `body_ar` TEXT NULL,
    `discount_code` VARCHAR(64) NULL,
    `audience` JSON NOT NULL,
    `branch_id` VARCHAR(64) NULL,
    `scheduled_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `audience_size` INTEGER NULL,
    `last_error` VARCHAR(500) NULL,
    `created_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `campaigns_status_scheduled_at_idx`(`status`, `scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campaign_recipients` (
    `id` VARCHAR(191) NOT NULL,
    `campaign_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NULL,
    `address` VARCHAR(255) NULL,
    `locale` VARCHAR(5) NOT NULL DEFAULT 'en',
    `status` ENUM('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NULL,
    `provider_message_id` VARCHAR(128) NULL,
    `last_error` VARCHAR(300) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `campaign_recipients_campaign_id_status_idx`(`campaign_id`, `status`),
    INDEX `campaign_recipients_provider_message_id_idx`(`provider_message_id`),
    UNIQUE INDEX `campaign_recipients_campaign_id_customer_id_key`(`campaign_id`, `customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `marketing_suppressions` (
    `id` VARCHAR(191) NOT NULL,
    `channel` ENUM('EMAIL', 'SMS') NOT NULL,
    `address` VARCHAR(255) NOT NULL,
    `reason` ENUM('UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED', 'MANUAL') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `marketing_suppressions_channel_address_key`(`channel`, `address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `campaign_recipients` ADD CONSTRAINT `campaign_recipients_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaign_recipients` ADD CONSTRAINT `campaign_recipients_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

