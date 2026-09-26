-- When the person finished (or dismissed) the first-login welcome. NULL means
-- they have never seen it. Existing accounts are backfilled so only people
-- created from now on get the welcome.
ALTER TABLE `users` ADD COLUMN `onboarded_at` DATETIME(3) NULL;
UPDATE `users` SET `onboarded_at` = CURRENT_TIMESTAMP(3);
