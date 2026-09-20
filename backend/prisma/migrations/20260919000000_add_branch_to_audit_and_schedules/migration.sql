-- AlterTable
ALTER TABLE `audit_log` ADD COLUMN `branch_id` VARCHAR(64) NULL;

-- AlterTable
ALTER TABLE `scheduled_reports` ADD COLUMN `branch_id` VARCHAR(64) NULL;

-- CreateIndex
CREATE INDEX `audit_log_branch_id_created_at_idx` ON `audit_log`(`branch_id`, `created_at`);

-- CreateIndex
CREATE INDEX `scheduled_reports_branch_id_created_at_idx` ON `scheduled_reports`(`branch_id`, `created_at`);
