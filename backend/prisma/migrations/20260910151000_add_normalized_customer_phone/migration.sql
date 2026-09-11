ALTER TABLE `customers` ADD COLUMN `phone_normalized` VARCHAR(32) NULL;
UPDATE `customers`
SET `phone_normalized` = REGEXP_REPLACE(`phone`, '[^0-9]', '')
WHERE `phone` IS NOT NULL;
CREATE INDEX `customers_phone_normalized_idx` ON `customers`(`phone_normalized`);
