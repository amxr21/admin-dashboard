-- CreateTable
CREATE TABLE `delivery_staff_branches` (
    `id` VARCHAR(191) NOT NULL,
    `courier_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `delivery_staff_branches_branch_id_idx`(`branch_id`),
    UNIQUE INDEX `delivery_staff_branches_courier_id_branch_id_key`(`courier_id`, `branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `delivery_staff_branches` ADD CONSTRAINT `delivery_staff_branches_courier_id_fkey` FOREIGN KEY (`courier_id`) REFERENCES `delivery_staff`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_staff_branches` ADD CONSTRAINT `delivery_staff_branches_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

