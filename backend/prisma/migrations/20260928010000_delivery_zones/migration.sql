CREATE TABLE delivery_zones (
  id VARCHAR(191) NOT NULL,
  code VARCHAR(48) NOT NULL,
  name VARCHAR(120) NOT NULL,
  fee DECIMAL(12,2) NOT NULL,
  free_delivery_threshold DECIMAL(12,2) NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL,
  UNIQUE INDEX delivery_zones_code_key(code), PRIMARY KEY(id)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE orders
 ADD COLUMN delivery_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
 ADD COLUMN delivery_tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
 ADD COLUMN delivery_zone_id VARCHAR(64) NULL,
 ADD COLUMN delivery_zone_name VARCHAR(120) NULL;
