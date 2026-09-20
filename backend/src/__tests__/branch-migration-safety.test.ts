import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function migrationSql(name: string): Promise<string> {
  return readFile(new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
}

describe('branch attribution migration safety', () => {
  it('keeps pre-existing audit and scheduled-report rows unattributed', async () => {
    const sql = await migrationSql('20260919000000_add_branch_to_audit_and_schedules');

    expect(sql).toMatch(/audit_log` ADD COLUMN `branch_id` VARCHAR\(64\) NULL/i);
    expect(sql).toMatch(/scheduled_reports` ADD COLUMN `branch_id` VARCHAR\(64\) NULL/i);
    expect(sql).not.toMatch(/\bUPDATE\s+`?(audit_log|scheduled_reports)`?/i);
  });

  it('does not fabricate per-branch variant stock from the global total', async () => {
    const sql = await migrationSql('20260920090000_add_branch_variant_stock');

    expect(sql).not.toMatch(/\bINSERT\s+INTO\s+`branch_variant_stock`/i);
    expect(sql).not.toMatch(/\bUPDATE\s+`branch_variant_stock`/i);
    expect(sql).toContain('No legacy backfill is attempted');
  });
});
