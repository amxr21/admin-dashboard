import { PolicyType } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';

/**
 * Return/Privacy/Terms/Shipping policy documents (B3.5).
 *
 * ─── APPEND-ONLY HISTORY, SAME DISCIPLINE AS StockMovement/AuditLog ───
 * `PolicyVersion` rows are never edited or deleted — publishing new text
 * always INSERTs a new version and repoints `Policy.publishedVersionId` at
 * it, inside one transaction. Reverting to an older version is the same
 * operation with old content: it creates a NEW version carrying that
 * content rather than rewriting history, so "what did this say on the day
 * a customer read it" stays answerable even after a revert.
 *
 * ─── WHY LOCALE IS A PLAIN STRING, VALIDATED HERE ─────────────────────
 * The schema has no FK to the frontend's locale list — this package has no
 * dependency on `frontend/`. `SUPPORTED_LOCALES` is this service's own
 * allowlist, kept in step with `frontend/src/i18n/routing.ts`'s `LOCALES`
 * by convention (both are `['en', 'ar']`), the same "two copies of a short,
 * rarely-changing list" trade already made for `DEMO_TAG` in
 * demo-data.service.ts.
 */

export const SUPPORTED_LOCALES = ['en', 'ar'] as const;
export type PolicyLocale = (typeof SUPPORTED_LOCALES)[number];

function assertLocale(locale: string): asserts locale is PolicyLocale {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    throw AppError.badRequest(`Unsupported locale "${locale}"`, {
      allowed: SUPPORTED_LOCALES,
    });
  }
}

const POLICY_VERSION_SELECT = {
  id: true,
  type: true,
  locale: true,
  version: true,
  content: true,
  createdById: true,
  createdAt: true,
} as const;

export interface PolicySummary {
  type: PolicyType;
  locale: PolicyLocale;
  /** Null when nothing has ever been published for this (type, locale). */
  version: number | null;
  content: string | null;
  updatedAt: string | null;
}

/**
 * Every (type, locale) pair, published text only — the settings page's
 * overview grid. A pair with no `Policy` row (never published) still
 * appears, with nulls, so the UI can offer "publish the first version"
 * rather than the pair being invisible until something exists.
 */
export async function listPolicies(): Promise<PolicySummary[]> {
  const published = await prisma.policy.findMany({
    include: { publishedVersion: { select: POLICY_VERSION_SELECT } },
  });

  const byKey = new Map(published.map((row) => [`${row.type}:${row.locale}`, row]));

  const out: PolicySummary[] = [];
  for (const type of Object.values(PolicyType)) {
    for (const locale of SUPPORTED_LOCALES) {
      const row = byKey.get(`${type}:${locale}`);
      out.push({
        type,
        locale,
        version: row?.publishedVersion.version ?? null,
        content: row?.publishedVersion.content ?? null,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      });
    }
  }

  return out;
}

export interface PolicyVersionSummary {
  id: string;
  type: PolicyType;
  locale: PolicyLocale;
  version: number;
  content: string;
  createdById: string | null;
  createdAt: string;
}

function serialiseVersion(row: {
  id: string;
  type: PolicyType;
  locale: string;
  version: number;
  content: string;
  createdById: string | null;
  createdAt: Date;
}): PolicyVersionSummary {
  return {
    id: row.id,
    type: row.type,
    locale: row.locale as PolicyLocale,
    version: row.version,
    content: row.content,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Full history for one (type, locale), newest first — the "view history" panel. */
export async function listPolicyVersions(
  type: PolicyType,
  locale: string,
): Promise<PolicyVersionSummary[]> {
  assertLocale(locale);

  const rows = await prisma.policyVersion.findMany({
    where: { type, locale },
    orderBy: { version: 'desc' },
    select: POLICY_VERSION_SELECT,
  });

  return rows.map(serialiseVersion);
}

const MAX_CONTENT_LENGTH = 100_000;

/**
 * Publishes new text for (type, locale): inserts the next version and
 * repoints `Policy.publishedVersionId` at it, atomically. `version` is
 * computed inside the transaction from the current max, not a counter
 * column — two concurrent publishes for the same (type, locale) would
 * otherwise be a lost-update race on which one becomes version N vs N+1.
 */
export async function publishPolicy(
  type: PolicyType,
  locale: string,
  content: string,
  actorId: string | null,
): Promise<PolicyVersionSummary> {
  assertLocale(locale);

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw AppError.badRequest('Policy content cannot be empty', { field: 'content' });
  }
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    throw AppError.badRequest(`Policy content must be ${MAX_CONTENT_LENGTH} characters or fewer`, {
      field: 'content',
    });
  }

  return prisma.$transaction(async (tx) => {
    const latest = await tx.policyVersion.findFirst({
      where: { type, locale },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const created = await tx.policyVersion.create({
      data: { type, locale, version: nextVersion, content: trimmed, createdById: actorId },
      select: POLICY_VERSION_SELECT,
    });

    await tx.policy.upsert({
      where: { type_locale: { type, locale } },
      create: { type, locale, publishedVersionId: created.id },
      update: { publishedVersionId: created.id },
    });

    return serialiseVersion(created);
  });
}

/**
 * Reverts to an older version by PUBLISHING ITS CONTENT AS A NEW VERSION —
 * never by repointing at the old row directly. Repointing would make two
 * different (type, locale) publish events share one `PolicyVersion` id,
 * which breaks "this id is the text that was live between these two
 * timestamps" for anyone reading the history later.
 */
export async function revertPolicy(
  type: PolicyType,
  locale: string,
  versionId: string,
  actorId: string | null,
): Promise<PolicyVersionSummary> {
  assertLocale(locale);

  const target = await prisma.policyVersion.findUnique({
    where: { id: versionId },
    select: { type: true, locale: true, content: true },
  });

  if (!target || target.type !== type || target.locale !== locale) {
    throw AppError.notFound('Policy version not found');
  }

  return publishPolicy(type, locale, target.content, actorId);
}
