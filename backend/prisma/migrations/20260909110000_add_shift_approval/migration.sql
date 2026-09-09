-- AlterTable
ALTER TABLE `shifts` ADD COLUMN `approval_note` VARCHAR(255) NULL,
    ADD COLUMN `approval_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `approved_at` DATETIME(3) NULL,
    ADD COLUMN `approved_by_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `shifts_approval_status_started_at_idx` ON `shifts`(`approval_status`, `started_at`);

-- AddForeignKey
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_approved_by_id_fkey` FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every shift that existed BEFORE approval tracking did was never
-- "awaiting review" — it happened under the old rule where clocking on
-- carried no approval concept at all. Marking it APPROVED (not leaving the
-- PENDING default) keeps a pre-existing manager's queue from being flooded
-- with months of shifts nobody was ever going to review, and matches this
-- migration's own schema comment.
UPDATE `shifts` SET `approval_status` = 'APPROVED';
