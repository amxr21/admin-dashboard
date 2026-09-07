-- F8.4 — per-branch roles.
--
-- Additive only. This migration grants nothing and revokes nothing: a user
-- with no row here keeps their global `users.role` exactly, which is what
-- makes the upgrade a no-op for everyone who already exists.
--
-- Deliberately NOT backfilled. Inserting a row per (user, branch) would
-- invent an assignment nobody made, and the resolver reads "no row" as "use
-- the global role" precisely so that inventing one is unnecessary.

-- CreateTable
CREATE TABLE `user_branches` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `role` ENUM('DEVELOPER', 'OWNER', 'MANAGER', 'FULFILLMENT', 'SUPPORT', 'DEMO') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_branches_branch_id_idx`(`branch_id`),
    -- One role per person per branch. Two rows would make "what can they do
    -- here" ambiguous, and the resolver would pick one silently, differently
    -- depending on row order.
    UNIQUE INDEX `user_branches_user_id_branch_id_key`(`user_id`, `branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
-- Cascade: a role assignment has no meaning without the person or the branch.
-- What they DID survives either being removed — `AuditLog` references actors
-- by plain id for exactly this reason.
ALTER TABLE `user_branches` ADD CONSTRAINT `user_branches_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_branches` ADD CONSTRAINT `user_branches_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
