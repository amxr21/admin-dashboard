-- CreateTable
CREATE TABLE `branch_variant_stock` (
    `id` VARCHAR(191) NOT NULL,
    `variant_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `branch_variant_stock_branch_id_idx`(`branch_id`),
    UNIQUE INDEX `branch_variant_stock_variant_id_branch_id_key`(`variant_id`, `branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `branch_variant_stock`
  ADD CONSTRAINT `branch_variant_stock_variant_id_fkey`
  FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `branch_variant_stock`
  ADD CONSTRAINT `branch_variant_stock_branch_id_fkey`
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- No legacy backfill is attempted. Existing ProductVariant.stock and
-- branch-less movement rows are valid business-wide history, but there is no
-- deterministic evidence that they belonged to the seeded default branch.
-- New branch quantities therefore begin empty and are established by future
-- branch-attributed movements instead of silently inventing ownership.
