'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { apiFetch, ApiError } from '@/lib/api';
import { logout } from '@/lib/auth-api';
import {
  clearSession,
  readToken,
  readUser,
  writeSession,
  type SessionUser,
} from '@/lib/auth-storage';

/**
 * Session state for the app.
 *
 * The cached user renders immediately so the shell doesn't flash a spinner on
 * every load, then `/auth/me` revalidates in the background. If that call
 * fails with a 401 the session is cleared — a deactivated user's cached copy
 * must not keep them looking signed in.
 *
 * The cached role is a RENDERING HINT ONLY. It can be edited in devtools to
 * claim OWNER; the API refuses anything the real role disallows regardless.
 */

/**
 * What `signIn` resolves to. A 2FA account never reaches `SIGNED_IN` from
 * `signIn` alone — see `verifyTwoFactor`, the second half of that flow.
 */
export type SignInResult =
  | { status: 'SIGNED_IN' }
  | { status: 'TWO_FACTOR_REQUIRED'; pendingToken: string };

interface AuthContextValue {
  user: SessionUser | null;
  /** True until the first `/auth/me` settles. */
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  /** Second step of a 2FA login — exchanges the pending token plus a code
   * (TOTP or backup) for a real session. Throws the same shaped errors as
   * `signIn` on a wrong/expired code. */
  verifyTwoFactor: (pendingToken: string, code: string) => Promise<void>;
  signOut: () => void;
  /**
   * Seeds a NEW token for the CURRENT user, without re-authenticating.
   *
   * The one real caller is self-service password change: that endpoint
   * revokes every existing session, including the one that made the request,
   * and returns a fresh token in the same response so the caller isn't
   * immediately logged out by their own successful change.
   */
  applyNewToken: (token: string) => void;
  /** Merges a partial update into the cached user — e.g. after a self-service
   * name/phone edit — without a full `/auth/me` round trip. */
  updateCachedUser: (patch: Partial<SessionUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}

interface LoginResponse {
  token: string;
  user: SessionUser;
}

/** The shape `POST /auth/login` sends for a 2FA account — no token, no user,
 * just enough to move to the second step. */
interface TwoFactorRequiredResponse {
  twoFactorRequired: true;
  pendingToken: string;
}

function isTwoFactorRequired(
  body: LoginResponse | TwoFactorRequiredResponse,
): body is TwoFactorRequiredResponse {
  return 'twoFactorRequired' in body && body.twoFactorRequired === true;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hydrate from cache, then revalidate against the API.
  useEffect(() => {
    const cached = readUser();
    if (cached) setUser(cached);

    if (!readToken()) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    apiFetch<SessionUser>('/auth/me')
      .then((fresh) => {
        if (cancelled) return;
        setUser(fresh);
        const token = readToken();
        if (token) writeSession(token, fresh);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // 401 means the token is expired, forged, or the account was
        // deactivated — all of which mean "signed out".
        if (error instanceof ApiError && error.status === 401) {
          clearSession();
          setUser(null);
        }
        // Any other failure (network, 500) leaves the cached user in place.
        // Signing someone out because the API blipped is worse than letting
        // them keep a stale session that the API will reject anyway.
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    // Errors propagate deliberately — the form needs to distinguish 401 from
    // 423 from 429 and say something different for each.
    const result = await apiFetch<LoginResponse | TwoFactorRequiredResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    // The password checked out but the sign-in is NOT complete — no session
    // exists yet. Nothing is written to storage and `user` stays whatever it
    // already was (null, for the normal login-page case).
    if (isTwoFactorRequired(result)) {
      return { status: 'TWO_FACTOR_REQUIRED', pendingToken: result.pendingToken };
    }

    writeSession(result.token, result.user);
    setUser(result.user);
    return { status: 'SIGNED_IN' };
  }, []);

  const verifyTwoFactor = useCallback(async (pendingToken: string, code: string) => {
    const result = await apiFetch<LoginResponse>('/auth/login/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ pendingToken, code }),
    });

    writeSession(result.token, result.user);
    setUser(result.user);
  }, []);

  const signOut = useCallback(() => {
    // B1.7 — best-effort, not awaited: the local session is cleared either
    // way, and this is only what turns it into an audited `auth.logout`
    // event server-side. A failed/slow request must never delay or block
    // the user actually being signed out.
    void logout().catch(() => {});
    clearSession();
    setUser(null);
  }, []);

  const applyNewToken = useCallback((token: string) => {
    setUser((current) => {
      // Should be unreachable — only a signed-in user can request this — but
      // silently doing nothing would leave the OLD (now-revoked) token in
      // storage, and the next request would 401 with no explanation.
      if (!current) return current;
      writeSession(token, current);
      return current;
    });
  }, []);

  const updateCachedUser = useCallback((patch: Partial<SessionUser>) => {
    setUser((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      const token = readToken();
      if (token) writeSession(token, next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      signIn,
      verifyTwoFactor,
      signOut,
      applyNewToken,
      updateCachedUser,
    }),
    [user, isLoading, signIn, verifyTwoFactor, signOut, applyNewToken, updateCachedUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
