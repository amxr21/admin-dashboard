-- AlterTable
ALTER TABLE `stock_movements` ADD COLUMN `branch_id` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `branch_stock` (
    `id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `branch_stock_branch_id_idx`(`branch_id`),
    UNIQUE INDEX `branch_stock_product_id_branch_id_key`(`product_id`, `branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `branch_stock` ADD CONSTRAINT `branch_stock_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branch_stock` ADD CONSTRAINT `branch_stock_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── BACKFILL: everything that exists today is at the default branch ──
--
-- Without this, every historical movement would have a null branch and every
-- product would show zero stock everywhere — the running totals would be
-- correct in `products.stock` and absent per branch, which reads as "we own
-- 40 but none of them are anywhere".
--
-- Movements first, then the per-branch totals.
--
-- The total is `products.stock`, NOT the sum of deltas, and that choice
-- matters. Deriving from the log is the purer answer and it is what
-- `reconcile()` checks against — but this database already contains products
-- whose `stock` is set with no movements at all (seeded rows written before
-- the log existed). Deriving would silently reset those to zero, changing
-- what the app shows for stock a business actually holds.
--
-- A migration must not decide that. It preserves the number the app has been
-- displaying and leaves the pre-existing drift visible to `reconcile()`,
-- which is the tool built to report exactly this and let a human correct it
-- with a real CORRECTION movement.
UPDATE `stock_movements`
SET `branch_id` = 'branch_default'
WHERE `branch_id` IS NULL;

INSERT INTO `branch_stock` (`id`, `product_id`, `branch_id`, `quantity`, `created_at`, `updated_at`)
SELECT
  CONCAT('bs_', p.`id`),
  p.`id`,
  'branch_default',
  p.`stock`,
  NOW(3),
  NOW(3)
FROM `products` p
WHERE NOT EXISTS (
  SELECT 1 FROM `branch_stock` bs
  WHERE bs.`product_id` = p.`id` AND bs.`branch_id` = 'branch_default'
);
