-- Who rang up a sale, and who approved a return.
--
-- Purely additive: five nullable columns, no backfill. NULL is the honest
-- value for every existing row — an order placed before this existed has no
-- recorded cashier, and inventing one from the audit log would be a guess
-- presented as a fact on a printed receipt.

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `sold_by_id` VARCHAR(64) NULL,
    ADD COLUMN `sold_by_name` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `returns` ADD COLUMN `approved_at` DATETIME(3) NULL,
    ADD COLUMN `approved_by_id` VARCHAR(64) NULL,
    ADD COLUMN `approved_by_name` VARCHAR(255) NULL;
