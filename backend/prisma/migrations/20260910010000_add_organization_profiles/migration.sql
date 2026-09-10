CREATE TABLE `organization_fields` (
  `id` VARCHAR(191) NOT NULL,
  `entity_type` VARCHAR(20) NOT NULL,
  `label` VARCHAR(120) NOT NULL,
  `type` VARCHAR(20) NOT NULL,
  `required` BOOLEAN NOT NULL DEFAULT false,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `organization_fields_entity_type_is_active_idx` (`entity_type`, `is_active`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `organization_profiles` (
  `id` VARCHAR(191) NOT NULL,
  `entity_type` VARCHAR(20) NOT NULL,
  `entity_id` VARCHAR(64) NOT NULL,
  `values` JSON NOT NULL,
  `job_title` VARCHAR(120) NULL,
  `department` VARCHAR(120) NULL,
  `manager_id` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `organization_profiles_entity_type_entity_id_key` (`entity_type`, `entity_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
