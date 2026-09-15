-- Which permission areas a key may reach.
--
-- Nullable, and NULL is the meaningful default rather than a gap: it means
-- "whatever the owner can reach", which is exactly how every key issued
-- before this column behaved. Backfilling existing keys to an explicit list
-- would silently narrow live integrations the moment this deploys.
--
-- Stored as a comma-separated area list rather than a join table: the values
-- come from a fixed 13-item vocabulary (`AREAS` in config/roles.ts), are read
-- as a whole set on every authenticated request, and are never queried
-- individually. A join table would add a second read to the hot auth path to
-- model a relationship nothing ever joins on.

-- AlterTable
ALTER TABLE `api_keys` ADD COLUMN `scopes` VARCHAR(512) NULL;
