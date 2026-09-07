-- AlterTable
ALTER TABLE `orders` ADD COLUMN `branch_id` VARCHAR(64) NULL;


-- Existing orders belong to the default branch (F8.3).
--
-- Every order that exists today was taken before branches did, so attributing
-- them to the single branch that existed is the truthful answer, not a guess.
--
-- Orders created LATER without a branch stay null on purpose: that means
-- "unattributed", which reports must state rather than hide. Backfilling
-- future nulls with a default is how a second branch's revenue would silently
-- appear under the first.
UPDATE `orders`
SET `branch_id` = (SELECT `id` FROM `branches` WHERE `is_default` = true LIMIT 1)
WHERE `branch_id` IS NULL;
