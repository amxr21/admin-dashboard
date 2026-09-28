import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError.js';
import {
  isRetryableTransactionError,
  retryDatabaseTransaction,
} from '../services/transaction-retry.service.js';

function known(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('database error', {
    code,
    clientVersion: '6.19.0',
    ...(meta ? { meta } : {}),
  });
}
afterEach(() => vi.useRealTimers());

describe('database transaction retry', () => {
  it('recognizes only confirmed deadlocks and MySQL lock wait failures', () => {
    expect(isRetryableTransactionError(known('P2034'))).toBe(true);
    expect(isRetryableTransactionError(known('P2010', { code: '1205' }))).toBe(true);
    expect(isRetryableTransactionError(known('P2010', { code: '1213' }))).toBe(true);
    expect(
      isRetryableTransactionError(
        known('P2028', { error: 'Lock wait timeout exceeded; try restarting transaction' }),
      ),
    ).toBe(true);
    expect(
      isRetryableTransactionError(
        new Prisma.PrismaClientUnknownRequestError(
          'Error querying database: Deadlock found when trying to get lock',
          { clientVersion: '6.19.0' },
        ),
      ),
    ).toBe(true);
    for (const error of [
      known('P2002'),
      known('P1001'),
      known('P2028'),
      known('P2010', { code: '1062' }),
      new Error('Lock wait timeout exceeded'),
      AppError.conflict('sold out'),
    ]) {
      expect(isRetryableTransactionError(error)).toBe(false);
    }
  });

  it('reruns the complete callback after a confirmed transaction rollback', async () => {
    vi.useFakeTimers();
    const execute = vi
      .fn()
      .mockRejectedValueOnce(known('P2034'))
      .mockRejectedValueOnce(known('P2010', { code: '1205' }))
      .mockResolvedValue({ id: 'committed' });
    const result = retryDatabaseTransaction(execute);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ id: 'committed' });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('caps attempts and reports contention as retryable availability, never sold out', async () => {
    vi.useFakeTimers();
    const execute = vi.fn().mockRejectedValue(known('P2034'));
    const assertion = expect(retryDatabaseTransaction(execute)).rejects.toMatchObject({
      statusCode: 503,
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(execute).toHaveBeenCalledTimes(8);
  });

  it('does not retry validation failures, stock exhaustion or uncertain connection failures', async () => {
    for (const error of [AppError.conflict('sold out'), known('P1001'), known('P2028')]) {
      const execute = vi.fn().mockRejectedValue(error);
      await expect(retryDatabaseTransaction(execute)).rejects.toBe(error);
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });
});
