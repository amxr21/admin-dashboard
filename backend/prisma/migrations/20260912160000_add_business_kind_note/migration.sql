-- Additive: rows predating the URG-021 catalogue keep their free-text `kind`
-- and have no note. No value is guessed for them and nothing is rewritten.
ALTER TABLE `businesses`
  ADD COLUMN `kind_note` VARCHAR(200) NULL;
