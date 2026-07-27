-- DropIndex
DROP INDEX `delivery_staff_access_code_key` ON `delivery_staff`;

-- AlterTable
ALTER TABLE `delivery_assignments` MODIFY `status` ENUM('ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'HANDED_OVER', 'CANCELED', 'RETURNED') NOT NULL DEFAULT 'ASSIGNED';

-- AlterTable
ALTER TABLE `delivery_staff` DROP COLUMN `access_code`,
    ADD COLUMN `access_code_hash` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `delivery_staff_access_code_hash_key` ON `delivery_staff`(`access_code_hash`);

