import { apiFetch } from '@/lib/api';

/**
 * Client for `GET /diagnostics` — DEVELOPER-only, and deliberately thin:
 * the endpoint itself already decided what is safe to expose (booleans and
 * links, never a secret or connection string). This file just types the
 * shape; it adds no logic of its own.
 */

export interface Diagnostics {
  environment: string;
  isProduction: boolean;
  uptimeSeconds: number;
  node: string;
  database: {
    reachable: boolean;
    latencyMs: number;
    kind?: string;
  };
  migrations: { name: string; appliedAt: string | null }[];
  observability: {
    sentry: { configured: boolean; dashboard: string | null };
    logs: { dashboard: string | null };
  };
}

export async function fetchDiagnostics(): Promise<Diagnostics> {
  return apiFetch<Diagnostics>('/diagnostics');
}
