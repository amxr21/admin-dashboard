import { setTimeout as delay } from 'node:timers/promises';
import { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError.js';

const MAX_TRANSACTION_ATTEMPTS = 8;

/** Only database-confirmed deadlocks/lock waits are safe to retry. Connection
 * loss and generic transaction timeouts can have an uncertain commit outcome. */
export function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034') return true;
    if (error.code === 'P2010') {
      // MySQL: 1205 lock wait timeout, 1213 deadlock.
      const mysqlCode = error.meta?.code;
      return ['1205', '1213', 1205, 1213].includes(mysqlCode as string | number);
    }
    // Prisma may wrap connector lock errors as transaction errors. Do not
    // retry a generic P2028 (expired transaction / interactive timeout).
    if (error.code !== 'P2028') return false;
    const detail = typeof error.meta?.error === 'string' ? error.meta.error : '';
    return /Lock wait timeout exceeded|Deadlock found when trying to get lock/i.test(
      `${error.message} ${detail}`,
    );
  }
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    /Lock wait timeout exceeded|Deadlock found when trying to get lock/i.test(error.message)
  );
}

/** The callback must start a fresh transaction on every attempt. It must not
 * perform external side effects; only rolled-back database writes are retried. */
export async function retryDatabaseTransaction<T>(execute: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await execute();
    } catch (error) {
      if (!isRetryableTransactionError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS - 1) {
        throw AppError.serviceUnavailable(
          'The store is busy. Please retry your request with the same request key.',
        );
      }
      // Jitter keeps competing buyers from repeatedly colliding in lockstep.
      const ceiling = Math.min(250, 25 * 2 ** attempt);
      await delay(ceiling / 2 + (Math.random() * ceiling) / 2);
    }
  }
  throw AppError.serviceUnavailable('The store is busy. Please try again.');
}
