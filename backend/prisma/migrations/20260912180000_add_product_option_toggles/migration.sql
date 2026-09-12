-- URG-029/030 — per-product opt-in for the variant and colour dimensions.
--
-- Nullable and never backfilled: NULL means "the owner has not said", which is
-- deliberately distinct from an explicit false. A product that already HAS
-- variants is treated as enabled by the resolver, so no existing row changes
-- behaviour and no data is guessed at here.
ALTER TABLE `products`
  ADD COLUMN `has_variants` BOOLEAN NULL,
  ADD COLUMN `has_colors` BOOLEAN NULL;
