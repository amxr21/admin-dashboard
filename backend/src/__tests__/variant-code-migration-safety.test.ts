import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function migrationSql(): Promise<string> {
  return readFile(
    new URL(
      '../../prisma/migrations/20260924090000_require_variant_sku/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
}

describe('required variant SKU migration safety', () => {
  it('backfills only missing codes before making the column required', async () => {
    const sql = await migrationSql();
    const updateAt = sql.search(/UPDATE\s+`product_variants`/i);
    const notNullAt = sql.search(/MODIFY\s+`sku`\s+VARCHAR\(64\)\s+NOT NULL/i);

    expect(updateAt).toBeGreaterThanOrEqual(0);
    expect(notNullAt).toBeGreaterThan(updateAt);
    expect(sql).toMatch(/WHERE\s+`sku`\s+IS NULL\s+OR\s+TRIM\(`sku`\)\s*=\s*''/i);
  });

  it('derives backfilled codes from each immutable variant id', async () => {
    const sql = await migrationSql();

    expect(sql).toMatch(/CONCAT\('AUTO-VAR-',\s*`id`\)/i);
    expect(sql).not.toMatch(/SET\s+`sku`\s*=\s*'[^']+'/i);
  });
});
