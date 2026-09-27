-- Pickup as a real path: an order records how it is fulfilled, and a pickup
-- order moves CONFIRMED → READY_FOR_PICKUP → COLLECTED instead of through
-- SHIPPED/DELIVERED. Existing orders keep a NULL fulfillment, which may take
-- either path, so nothing already in flight is stranded.

-- AlterTable
ALTER TABLE `customer_order_notifications` MODIFY `order_status` ENUM('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'COLLECTED', 'CANCELED', 'RETURNED') NOT NULL;

-- AlterTable
ALTER TABLE `order_status_history` MODIFY `from_status` ENUM('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'COLLECTED', 'CANCELED', 'RETURNED') NULL,
    MODIFY `to_status` ENUM('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'COLLECTED', 'CANCELED', 'RETURNED') NOT NULL;

-- AlterTable: the checkout's contact and delivery details, which until now
-- were only kept as free text in an internal order note.
ALTER TABLE `orders` ADD COLUMN `contact_email` VARCHAR(255) NULL,
    ADD COLUMN `contact_name` VARCHAR(200) NULL,
    ADD COLUMN `contact_phone` VARCHAR(48) NULL,
    ADD COLUMN `customer_note` VARCHAR(1000) NULL,
    ADD COLUMN `delivery_address` VARCHAR(500) NULL,
    ADD COLUMN `delivery_city` VARCHAR(96) NULL,
    ADD COLUMN `fulfillment` ENUM('DELIVERY', 'PICKUP') NULL,
    MODIFY `status` ENUM('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'COLLECTED', 'CANCELED', 'RETURNED') NOT NULL DEFAULT 'PENDING';
