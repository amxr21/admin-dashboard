export interface RequestIntent {
  key: string;
  fingerprint: string;
}

/**
 * Reuse a mutation key only while the submitted payload is unchanged.
 *
 * This lets a user safely retry an ambiguous network failure, while an edit
 * creates a genuinely new intent instead of conflicting with the old one.
 */
export function requestIntentFor(
  payload: unknown,
  current: RequestIntent | null,
  createKey: () => string = () => crypto.randomUUID(),
): RequestIntent {
  const fingerprint = JSON.stringify(payload);

  if (current?.fingerprint === fingerprint) return current;

  return { key: createKey(), fingerprint };
}
