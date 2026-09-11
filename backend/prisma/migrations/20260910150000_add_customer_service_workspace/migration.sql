CREATE TABLE `customer_cases` (
  `id` VARCHAR(191) NOT NULL,
  `case_number` VARCHAR(40) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` TEXT NULL,
  `status` ENUM('OPEN', 'WAITING', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  `priority` ENUM('NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
  `branch_id` VARCHAR(64) NULL,
  `customer_id` VARCHAR(191) NULL,
  `order_id` VARCHAR(191) NULL,
  `assigned_to_id` VARCHAR(191) NULL,
  `created_by_id` VARCHAR(64) NOT NULL,
  `resolved_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `customer_cases_case_number_key`(`case_number`),
  INDEX `customer_cases_branch_id_status_updated_at_idx`(`branch_id`, `status`, `updated_at`),
  INDEX `customer_cases_customer_id_idx`(`customer_id`),
  INDEX `customer_cases_order_id_idx`(`order_id`),
  INDEX `customer_cases_assigned_to_id_idx`(`assigned_to_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `customer_cases_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `customer_cases_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `customer_cases_assigned_to_id_fkey` FOREIGN KEY (`assigned_to_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `customer_case_notes` (
  `id` VARCHAR(191) NOT NULL,
  `case_id` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL,
  `author_id` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `customer_case_notes_case_id_created_at_idx`(`case_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `customer_case_notes_case_id_fkey` FOREIGN KEY (`case_id`) REFERENCES `customer_cases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `customer_order_notifications` (
  `id` VARCHAR(191) NOT NULL,
  `order_id` VARCHAR(191) NOT NULL,
  `customer_id` VARCHAR(191) NULL,
  `order_status` ENUM('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELED', 'RETURNED') NOT NULL,
  `channel` VARCHAR(24) NOT NULL DEFAULT 'email',
  `recipient` VARCHAR(255) NULL,
  `delivery_status` ENUM('PENDING', 'SENT', 'SKIPPED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `failure_code` VARCHAR(64) NULL,
  `sent_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `uq_customer_order_notification`(`order_id`, `order_status`, `channel`),
  INDEX `customer_order_notifications_delivery_status_created_at_idx`(`delivery_status`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `customer_order_notifications_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `customer_order_notifications_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
