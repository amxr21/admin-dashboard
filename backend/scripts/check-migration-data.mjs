#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A read-only check for the data-only catalogue baseline migration.
 * Passing these invariants cannot prove the historical snapshots are accurate
 * or that unrelated backfills ran; migration history still needs review.
 */
export async function inspectCatalogueBaselines(db) {
  const totalProducts = await db.product.count();
  const zeroVersionProducts = await db.product.count({
    where: { catalogueVersion: 0 },
  });
  const missingFirstSnapshots = await db.product.count({
    where: { catalogueVersions: { none: { version: 1 } } },
  });

  return {
    totalProducts,
    zeroVersionProducts,
    missingFirstSnapshots,
    valid: zeroVersionProducts === 0 && missingFirstSnapshots === 0,
  };
}

export async function runMigrationDataCheck({
  db = new PrismaClient(),
  report = (message) => process.stderr.write(`[migration-data] ${message}\n`),
} = {}) {
  let exitCode = 0;
  try {
    const result = await inspectCatalogueBaselines(db);
    report(
      `Catalogue baseline invariant: products=${result.totalProducts}, ` +
        `zero-version products=${result.zeroVersionProducts}, ` +
        `products missing version-1 snapshot=${result.missingFirstSnapshots}.`,
    );
    if (!result.valid) {
      report(
        'INCOMPLETE_DATA: investigate the affected product histories against a backup. ' +
          'Do not recreate old snapshots from current product values or blindly replay SQL.',
      );
      exitCode = 2;
    } else if (result.totalProducts === 0) {
      report('No products exist; the catalogue backfill has no rows to verify.');
    } else {
      report(
        'Known catalogue invariant holds; this does not verify migration history ' +
          'or other historical backfills.',
      );
    }
  } catch (error) {
    report(
      `CHECK_FAILED: read-only query failed (${errorCode(error)}). ` +
        'Inspect private database logs; no healthy result can be inferred.',
    );
    exitCode = 1;
  } finally {
    try {
      await db.$disconnect();
    } catch (error) {
      report(`CHECK_FAILED: database disconnect failed (${errorCode(error)}).`);
      exitCode = 1;
    }
  }
  return exitCode;
}

function errorCode(error) {
  return error && typeof error === 'object' && typeof error.code === 'string'
    ? error.code
    : 'unknown';
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runMigrationDataCheck()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.stderr.write('[migration-data] CHECK_FAILED: checker could not start.\n');
      process.exitCode = 1;
    });
}
