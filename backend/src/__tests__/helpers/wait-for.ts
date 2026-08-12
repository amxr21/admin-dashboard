/**
 * Polls `check` until it returns a truthy value or `timeoutMs` elapses.
 *
 * Several backend writes (audit, notifications) are fire-and-forget by
 * design — the HTTP response can return before the write lands. A fixed
 * `setTimeout` guess is fine against a local DB but flakes against a remote
 * one, where a single write can take anywhere from ~200ms to several
 * seconds. Polling waits exactly as long as needed instead of gambling on a
 * constant, so it doesn't fail on a slow connection or waste time on a fast
 * one.
 */
export async function waitFor<T>(
  check: () => Promise<T | null | undefined>,
  { timeoutMs = 10_000, intervalMs = 100 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
