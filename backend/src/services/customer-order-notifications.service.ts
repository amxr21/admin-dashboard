import { CustomerDeliveryStatus, OrderStatus, Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { sendEmailToRecipients } from './email.service.js';

const STATUS_COPY: Record<OrderStatus, string> = {
  PENDING: 'has been received',
  CONFIRMED: 'has been confirmed',
  SHIPPED: 'has been shipped',
  DELIVERED: 'has been delivered',
  CANCELED: 'has been canceled',
  RETURNED: 'has been marked as returned',
};

/**
 * Record and attempt one customer-facing update per order/status/channel.
 * Never throws into the order transition: customer communication can fail,
 * but the operational status change must remain committed and visible.
 */
async function attemptCustomerOrderStatusNotification(orderId: string, status: OrderStatus) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      customer: { select: { name: true, email: true } },
    },
  });
  if (!order) return;

  const existing = await prisma.customerOrderNotification.findUnique({
    where: { orderId_orderStatus_channel: { orderId, orderStatus: status, channel: 'email' } },
    select: { deliveryStatus: true },
  });
  if (existing?.deliveryStatus === CustomerDeliveryStatus.SENT) return;

  const recipient = order.customer?.email ?? null;
  await prisma.customerOrderNotification.upsert({
    where: { orderId_orderStatus_channel: { orderId, orderStatus: status, channel: 'email' } },
    create: {
      orderId,
      customerId: order.customerId,
      orderStatus: status,
      recipient,
      deliveryStatus: recipient ? CustomerDeliveryStatus.PENDING : CustomerDeliveryStatus.SKIPPED,
      failureCode: recipient ? null : 'NO_CUSTOMER_EMAIL',
    },
    update: {
      customerId: order.customerId,
      recipient,
      deliveryStatus: recipient ? CustomerDeliveryStatus.PENDING : CustomerDeliveryStatus.SKIPPED,
      failureCode: recipient ? null : 'NO_CUSTOMER_EMAIL',
    },
  });
  if (!recipient) return;

  const sent = await sendEmailToRecipients(
    [recipient],
    `Order ${order.orderNumber}: ${status.toLowerCase()}`,
    `Hello ${order.customer?.name ?? 'there'},\n\nYour order ${order.orderNumber} ${STATUS_COPY[status]}.`,
  );

  await prisma.customerOrderNotification.update({
    where: { orderId_orderStatus_channel: { orderId, orderStatus: status, channel: 'email' } },
    data: sent
      ? { deliveryStatus: CustomerDeliveryStatus.SENT, sentAt: new Date(), failureCode: null }
      : { deliveryStatus: CustomerDeliveryStatus.FAILED, failureCode: 'DELIVERY_UNAVAILABLE' },
  });
}

export async function notifyCustomerOrderStatus(orderId: string, status: OrderStatus) {
  try {
    await attemptCustomerOrderStatusNotification(orderId, status);
  } catch (error) {
    logger.error({
      event: 'customer_order_notification.failed',
      orderId,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Test seam and admin detail helper: delivery metadata only, no message body. */
export async function listCustomerOrderNotifications(orderId: string) {
  return prisma.customerOrderNotification.findMany({
    where: { orderId },
    select: {
      id: true, orderStatus: true, channel: true, recipient: true,
      deliveryStatus: true, failureCode: true, sentAt: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export function isUniqueNotificationConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
