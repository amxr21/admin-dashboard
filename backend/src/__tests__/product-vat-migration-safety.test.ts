import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260924150000_add_product_vat_applicability/migration.sql',
  ),
  'utf8',
);

describe('product VAT applicability migration', () => {
  it('preserves the existing rule by making every product taxable by default', () => {
    expect(migration).toMatch(
      /ALTER TABLE `products`[\s\S]*ADD COLUMN `is_taxable` BOOLEAN NOT NULL DEFAULT true/i,
    );
  });

  it('does not invent line-level tax facts for historical orders', () => {
    expect(migration).toMatch(
      /ALTER TABLE `order_items`[\s\S]*ADD COLUMN `is_taxable` BOOLEAN NULL/i,
    );
    expect(migration).not.toMatch(/UPDATE\s+`?order_items`?/i);
  });
});
