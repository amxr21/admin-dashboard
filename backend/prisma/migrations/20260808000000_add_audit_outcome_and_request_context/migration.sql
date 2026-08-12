-- AlterTable
ALTER TABLE `audit_log` ADD COLUMN `ip` VARCHAR(64) NULL,
    ADD COLUMN `outcome` ENUM('SUCCESS', 'DENIED', 'ERROR') NOT NULL DEFAULT 'SUCCESS',
    ADD COLUMN `user_agent` VARCHAR(255) NULL;

-- CreateIndex
CREATE INDEX `audit_log_outcome_created_at_idx` ON `audit_log`(`outcome`, `created_at`);

-- CreateIndex
CREATE INDEX `audit_log_request_id_idx` ON `audit_log`(`request_id`);

