/**
 * How MySQL and Prisma word a lost lock race: a deadlock victim, a lock wait
 * timeout, or Prisma's P2034 "write conflict or a deadlock". Contended writes
 * (the last few units of a product, a code's last use) lose these races in
 * normal operation, and the transactions that expect them retry.
 */
const LOCK_CONFLICT =
  /Lock wait timeout exceeded|Deadlock found when trying to get lock|write conflict or a deadlock/i;

export function isLockConflictMessage(message: string): boolean {
  return LOCK_CONFLICT.test(message);
}
