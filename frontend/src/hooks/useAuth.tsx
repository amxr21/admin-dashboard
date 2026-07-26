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

interface AuthContextValue {
  user: SessionUser | null;
  /** True until the first `/auth/me` settles. */
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
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

  const signIn = useCallback(async (email: string, password: string) => {
    // Errors propagate deliberately — the form needs to distinguish 401 from
    // 423 from 429 and say something different for each.
    const result = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    writeSession(result.token, result.user);
    setUser(result.user);
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, signIn, signOut }),
    [user, isLoading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
