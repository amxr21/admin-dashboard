ALTER TABLE `api_keys`
  ADD COLUMN `purpose` VARCHAR(255) NULL,
  ADD COLUMN `recipient` VARCHAR(255) NULL;

UPDATE `api_keys` SET
  `purpose` = 'Legacy key',
  `recipient` = 'Unknown (created before tracking)';

ALTER TABLE `api_keys`
  MODIFY COLUMN `purpose` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `recipient` VARCHAR(255) NOT NULL;
