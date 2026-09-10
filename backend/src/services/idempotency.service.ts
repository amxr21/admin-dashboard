import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

class ClaimAlreadyExists extends Error {}

export interface IdempotentExecution<T> {
  value: T;
  replayed: boolean;
}

interface ExecuteIdempotentlyOptions<T> {
  scope: string;
  actorId: string;
  key: string;
  request: unknown;
  execute: (tx: Prisma.TransactionClient) => Promise<T>;
  retentionMs?: number;
}

/**
 * JSON's normal object-key ordering depends on insertion order. Requests that
 * mean the same thing must hash the same way even when a caller assembled the
 * object differently, so keys are sorted recursively while array order stays
 * significant.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }

  return value;
}

export function hashIdempotentRequest(request: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(request))).digest('hex');
}

/** Delete records only after their retry window has elapsed. */
export async function pruneExpiredIdempotencyRecords(now = new Date()): Promise<number> {
  const result = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  return result.count;
}

function asStoredJson(value: unknown): Prisma.InputJsonValue {
  // Protected mutation results are API response data and therefore JSON-safe.
  // Round-tripping here rejects unsupported values instead of asking Prisma to
  // guess how to persist class instances such as Decimal or Date.
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function assertSameRequest(storedHash: string, requestHash: string): void {
  if (storedHash !== requestHash) {
    throw AppError.conflict(
      'This request key was already used for different details. Review the request and try again.',
      { field: 'Idempotency-Key' },
    );
  }
}

/**
 * Execute a mutation once and durably replay its response on retries.
 *
 * The unique claim is created at the start of the SAME transaction passed to
 * `execute`. Concurrent requests with one key serialize on that constraint;
 * the loser reads the winner's committed response. Any failure rolls back both
 * the claim and the business mutation, leaving a corrected retry free to run.
 */
export async function executeIdempotently<T>(
  options: ExecuteIdempotentlyOptions<T>,
): Promise<IdempotentExecution<T>> {
  const requestHash = hashIdempotentRequest(options.request);
  const uniqueWhere = {
    scope_actorId_key: {
      scope: options.scope,
      actorId: options.actorId,
      key: options.key,
    },
  } as const;

  const existing = await prisma.idempotencyRecord.findUnique({
    where: uniqueWhere,
    select: { requestHash: true, response: true },
  });

  if (existing) {
    assertSameRequest(existing.requestHash, requestHash);
    return { value: existing.response as T, replayed: true };
  }

  try {
    const value = await prisma.$transaction(async (tx) => {
      // `createMany(..., skipDuplicates)` maps to an atomic non-erroring claim
      // on MySQL. The loser of a normal simultaneous retry therefore does not
      // emit a false db.error/Sentry event before we replay the winner.
      const claim = await tx.idempotencyRecord.createMany({
        data: [{
          scope: options.scope,
          actorId: options.actorId,
          key: options.key,
          requestHash,
          response: {},
          expiresAt: new Date(Date.now() + (options.retentionMs ?? DEFAULT_RETENTION_MS)),
        }],
        skipDuplicates: true,
      });

      if (claim.count === 0) throw new ClaimAlreadyExists();

      const result = await options.execute(tx);

      await tx.idempotencyRecord.update({
        where: uniqueWhere,
        data: { response: asStoredJson(result) },
      });

      return result;
    });

    return { value, replayed: false };
  } catch (error) {
    const protectedWriteCollision =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

    if (!(error instanceof ClaimAlreadyExists) && !protectedWriteCollision) {
      throw error;
    }

    // P2002 can also come from the protected write (for example an unrelated
    // business unique index). Only translate it when our own claim now exists.
    const winner = await prisma.idempotencyRecord.findUnique({
      where: uniqueWhere,
      select: { requestHash: true, response: true },
    });

    if (!winner) throw error;

    assertSameRequest(winner.requestHash, requestHash);
    return { value: winner.response as T, replayed: true };
  }
}
