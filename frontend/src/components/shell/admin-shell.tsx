'use client';

import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { AuthGuard } from '@/components/auth/auth-guard';
import { SchemaProvider } from '@/components/providers/schema-provider';
import { SettingsProvider } from '@/components/providers/settings-provider';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from '@/i18n/navigation';
import type { StaffRole } from '@/config/areas';

/**
 * Connects the real session to the shell.
 *
 * Split from AppShell so that component stays presentational — it takes a
 * user and renders chrome, which is what makes it testable without mocking
 * auth, routing and storage.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const router = useRouter();

  return (
    <AuthGuard>
      {/* INSIDE AuthGuard: the schema request needs a token, and firing it for
          a signed-out user would just be a guaranteed 401 on every page load. */}
      {user ? (
        <SchemaProvider>
        <SettingsProvider>
        <AppShell
          user={{
            // The API allows a null name; the UI needs something to render.
            name: user.name ?? user.email,
            email: user.email,
            role: user.role as StaffRole,
          }}
          onSignOut={() => {
            signOut();
            router.replace('/login');
          }}
        >
          {children}
        </AppShell>
        </SettingsProvider>
        </SchemaProvider>
      ) : null}
    </AuthGuard>
  );
}
