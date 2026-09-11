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

export interface MigrationStatus {
  available: boolean;
  /** On disk, not yet reflected in `_prisma_migrations` — see the route for
   *  why this is a status report only, with no "apply" action next to it. */
  pending: string[];
  appliedNotOnDisk: string[];
}

export async function fetchMigrationStatus(): Promise<MigrationStatus> {
  return apiFetch<MigrationStatus>('/diagnostics/db/migrations');
}

export interface TableStat {
  table: string;
  /** InnoDB estimate, not an exact live count — see the route. */
  approxRows: number | null;
  dataBytes: number | null;
  indexBytes: number | null;
}

export async function fetchTableStats(): Promise<TableStat[]> {
  return apiFetch<TableStat[]>('/diagnostics/db/tables');
}

/**
 * One integration the owner configures through env vars on the host.
 *
 * `configured` and `partial` are separate states on purpose: partial means
 * some but not all of a group's variables are set, which is a typo to fix,
 * while neither means a deliberate decision not to use that integration.
 */
export type IntegrationKey = 'email' | 'uploads' | 'errorTracking' | 'logs' | 'customerSignIn';

export type IntegrationReadinessCode =
  | 'ready'
  | 'partial'
  | 'missing'
  | 'disabled'
  | 'missingSender'
  | 'smtpPartial'
  | 'smtpMissing';

export type IntegrationImpactCode =
  | 'emailDeliveryUnavailable'
  | 'uploadsUnavailable'
  | 'errorTrackingUnavailable'
  | 'logAggregationUnavailable'
  | 'customerGoogleSignInUnavailable';

export interface IntegrationStatus {
  key: IntegrationKey;
  configured: boolean;
  partial: boolean;
  /** Stable API codes; human-facing copy belongs to the active locale. */
  readinessCode: IntegrationReadinessCode;
  impactCode: IntegrationImpactCode;
  dashboard?: string | null;
}

export interface ConfigurationStatus {
  mode: {
    appMode: string;
    nodeEnv: string;
    isProduction: boolean;
    corsOriginCount: number;
  };
  integrations: IntegrationStatus[];
}

export async function fetchConfigurationStatus(): Promise<ConfigurationStatus> {
  return apiFetch<ConfigurationStatus>('/diagnostics/configuration');
}
