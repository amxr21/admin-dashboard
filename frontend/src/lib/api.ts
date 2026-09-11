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

import { API_BASE_URL } from '@/lib/api-config';
import { readBranchId, readToken } from '@/lib/auth-storage';
import { withLoadingActivity } from '@/lib/loading-activity';
import { handleSessionExpired } from '@/lib/session-recovery';

const API_URL = API_BASE_URL;

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

export type ApiRequestInit = RequestInit & {
  /** GET pages render their own loading state; opt in only for imperative GET actions. */
  globalLoading?: boolean;
};

export async function apiFetch<T>(
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const { globalLoading, ...requestInit } = init;
  const method = (requestInit.method ?? 'GET').toUpperCase();
  if (globalLoading || method !== 'GET') {
    return withLoadingActivity(() => performApiFetch<T>(path, requestInit));
  }
  return performApiFetch<T>(path, requestInit);
}

async function performApiFetch<T>(path: string, init: RequestInit): Promise<T> {
  // Attached here rather than at each call site, so no request can forget it.
  // Reading storage per-request (not once at module load) matters: a module
  // constant would capture the token at import time and keep sending a stale
  // one after sign-out.
  const token = readToken();
  /**
   * The active branch (F8.5), attached here for exactly the reason the token
   * is: no call site can forget it.
   *
   * As a per-request argument it would have to be threaded through every
   * fetch in the app, and the one that got missed would silently fall back to
   * "all branches" — the WIDEST answer, which is the wrong direction for a
   * missed scope to fail.
   *
   * Omitted entirely when null, so an unscoped request looks exactly as it
   * always did rather than sending an empty header the server has to special-
   * case.
   */
  const branchId = readBranchId();
  const locale = typeof document === 'undefined'
    ? undefined
    : document.documentElement.lang.split('-')[0];

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { 'X-Branch-Id': branchId } : {}),
      ...(locale ? { 'Accept-Language': locale } : {}),
      ...init.headers,
    },
    // Send cookies too, so a future move to httpOnly cookie auth needs no
    // change here.
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401 && token) handleSessionExpired();
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

/**
 * Same envelope handling as `apiFetch`, for a multipart body.
 *
 * Deliberately a SEPARATE function rather than a flag on `apiFetch`: that one
 * hardcodes `Content-Type: application/json` on every request, which is
 * exactly wrong for `FormData` — the browser has to set its own
 * `multipart/form-data` Content-Type (with the boundary parameter, which JS
 * cannot compute ahead of time), so this omits the header entirely rather
 * than fighting it.
 */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  return withLoadingActivity(() => performApiUpload<T>(path, formData));
}

async function performApiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = readToken();
  // Carried here too, so an upload is authorised against the same branch as
  // every other request from this tab. Leaving it off would make this the one
  // path where `requireArea` sees the global role.
  const branchId = readBranchId();

  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    body: formData,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { 'X-Branch-Id': branchId } : {}),
    },
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401 && token) handleSessionExpired();
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

  const body = (await response.json()) as { data: T };
  return body.data;
}

/**
 * Downloads a file the API returns as an attachment (e.g. a report's CSV
 * export) and saves it via the browser, rather than parsing it as `{ data }`.
 *
 * A plain `<a href>` can't carry the Bearer token, so the request goes
 * through `fetch` here and the response is turned into an object URL a
 * synthetic link can click through — the one DOM-poking exception to
 * "components don't touch the document directly" in this codebase, and it
 * exists only because saving a file has no other browser API.
 */
export async function apiDownload(path: string, fallbackFilename: string): Promise<void> {
  return withLoadingActivity(() => performApiDownload(path, fallbackFilename));
}

async function performApiDownload(path: string, fallbackFilename: string): Promise<void> {
  const token = readToken();
  // Exports must match what is on screen: a CSV downloaded while scoped to
  // one branch that quietly contained every branch is the F4.3 problem again,
  // in a file that outlives the page it came from.
  const branchId = readBranchId();

  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { 'X-Branch-Id': branchId } : {}),
    },
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401 && token) handleSessionExpired();
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

  const blob = await response.blob();
  // The server names the file; a hardcoded fallback only covers the response
  // somehow arriving without the header at all.
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackFilename;

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
