-- Every variant must have a stable, unique catalogue code. Preserve existing
-- user-entered SKUs and deterministically backfill only legacy null/blank rows.
-- The cuid-backed id keeps generated values unique and under VARCHAR(64).
UPDATE `product_variants`
SET `sku` = CONCAT('AUTO-VAR-', `id`)
WHERE `sku` IS NULL OR TRIM(`sku`) = '';

ALTER TABLE `product_variants`
  MODIFY `sku` VARCHAR(64) NOT NULL;
