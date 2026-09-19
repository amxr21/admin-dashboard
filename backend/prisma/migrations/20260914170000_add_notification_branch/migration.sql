-- Which branch an in-app notification is about.
--
-- Purely additive: one nullable column, no backfill. NULL is the honest value
-- for every existing row, and it is also a MEANINGFUL one going forward —
-- NULL means branch-independent, so those rows show under every branch rather
-- than vanishing when one is selected. Backfilling old alerts to a guessed
-- branch would do the opposite: hide each one from every branch but that
-- guess. See the column's own note in schema.prisma.

-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `branch_id` VARCHAR(64) NULL;

-- CreateIndex
CREATE INDEX `notifications_branch_id_is_read_created_at_idx` ON `notifications`(`branch_id`, `is_read`, `created_at`);
