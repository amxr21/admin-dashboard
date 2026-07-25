/**
 * Typed client for the Express API.
 *
 * Why a wrapper instead of calling fetch directly:
 * the backend answers with exactly two shapes — `{ data }` on success and
 * `{ error: { code, message, requestId } }` on failure (see
 * backend/src/middleware/errorHandler.ts). Unwrapping that in every component
 * means the envelope gets handled slightly differently in twenty places, and
 * `res.ok` gets forgotten in at least one of them — which is how a failed
 * request ends up rendered as an empty table instead of an error state.
 *
 * This centralises it: callers get `T` or an `ApiError` they can catch.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** The error envelope the backend returns for every failure. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Carry this into bug reports — it maps to the exact backend log lines. */
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

type ErrorBody = {
  error?: { code?: string; message?: string; requestId?: string; details?: unknown };
};

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
    // Send cookies so session auth works once it lands.
    credentials: 'include',
  });

  if (!response.ok) {
    // A 502 from the proxy, or a crash before the error handler ran, returns
    // HTML — not the JSON envelope. Don't let that throw a parse error and
    // mask the real status code.
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // leave body empty
    }

    throw new ApiError(
      response.status,
      body.error?.code ?? 'UNKNOWN_ERROR',
      body.error?.message ?? `Request failed with status ${response.status}`,
      body.error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
      body.error?.details,
    );
  }

  // 204 No Content has no body to parse.
  if (response.status === 204) return undefined as T;

  const body = (await response.json()) as { data: T };
  return body.data;
}
