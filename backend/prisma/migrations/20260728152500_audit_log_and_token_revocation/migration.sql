-- AlterTable: token revocation. Default 0 so every existing token stays valid
-- through the deploy — the point is to be ABLE to revoke, not to log everyone out.
ALTER TABLE `users` ADD COLUMN `token_version` INTEGER NOT NULL DEFAULT 0;

-- CreateTable: append-only audit trail.
CREATE TABLE `audit_log` (
    `id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `entity` VARCHAR(48) NOT NULL,
    `entity_id` VARCHAR(64) NULL,
    `actor_id` VARCHAR(64) NULL,
    `actor_email` VARCHAR(255) NULL,
    `actor_role` VARCHAR(32) NULL,
    `changes` JSON NULL,
    `request_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_entity_entity_id_idx`(`entity`, `entity_id`),
    INDEX `audit_log_actor_id_created_at_idx`(`actor_id`, `created_at`),
    INDEX `audit_log_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
