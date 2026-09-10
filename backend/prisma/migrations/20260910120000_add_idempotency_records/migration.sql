-- A retry-safe mutation claim. The row is inserted and completed in the same
-- transaction as the protected write, so no replay can point at rolled-back
-- business data.
CREATE TABLE `idempotency_records` (
    `id` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(64) NOT NULL,
    `actor_id` VARCHAR(64) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `response` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_idempotency_scope_actor_key`(`scope`, `actor_id`, `key`),
    INDEX `idx_idempotency_expires_at`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
