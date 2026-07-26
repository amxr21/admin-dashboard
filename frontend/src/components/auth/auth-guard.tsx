'use client';

import { useEffect, type ReactNode } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { useRouter } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Redirects unauthenticated users to the login page.
 *
 * This is a CONVENIENCE, not a security control. Every /admin page renders on
 * the client, so a determined user can bypass this guard entirely — and it
 * would gain them nothing, because each API call is independently
 * authenticated and authorised. The guard exists so a signed-out user sees a
 * login form rather than an empty dashboard full of failed requests.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Wait for the first /auth/me to settle. Redirecting during the initial
    // load would bounce every user with a valid cached session to /login.
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // Render nothing during the redirect rather than flashing the dashboard.
  if (!user) return null;

  return <>{children}</>;
}
