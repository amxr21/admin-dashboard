-- AlterTable
-- Track A's A5.2 (alt text per image) — schema was already updated in the
-- working tree with no migration yet. Split out from the Session migration
-- below so each change is attributed to the work that actually made it,
-- rather than folding an unrelated field into an unrelated feature's migration.
ALTER TABLE `product_images` ADD COLUMN `alt` VARCHAR(255) NULL;
