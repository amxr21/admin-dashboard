-- Where a key may be used: STAFF (the default, and what every existing key
-- keeps) or STOREFRONT (the public storefront API only).
ALTER TABLE `api_keys` ADD COLUMN `audience` ENUM('STAFF', 'STOREFRONT') NOT NULL DEFAULT 'STAFF';
