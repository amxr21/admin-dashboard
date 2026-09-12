import { describe, expect, it, vi } from 'vitest';

import {
  inspectCatalogueBaselines,
  runMigrationDataCheck,
} from '../../scripts/check-migration-data.mjs';

function fakeDb(zeroVersionProducts, missingFirstSnapshots, totalProducts = 2) {
  return {
    product: {
      count: vi.fn().mockResolvedValueOnce(totalProducts)
        .mockResolvedValueOnce(zeroVersionProducts)
        .mockResolvedValueOnce(missingFirstSnapshots),
    },
    $disconnect: vi.fn().mockResolvedValue(),
  };
}

describe('read-only migration data check', () => {
  it('checks both catalogue invariants with count queries only', async () => {
    const db = fakeDb(0, 0);
    await expect(inspectCatalogueBaselines(db)).resolves.toEqual({
      totalProducts: 2,
      zeroVersionProducts: 0,
      missingFirstSnapshots: 0,
      valid: true,
    });
    expect(db.product.count).toHaveBeenCalledWith({
      where: { catalogueVersion: 0 },
    });
    expect(db.product.count).toHaveBeenCalledWith();
    expect(db.product.count).toHaveBeenCalledWith({
      where: { catalogueVersions: { none: { version: 1 } } },
    });
  });

  it('reports incomplete data without writing or fabricating a baseline', async () => {
    const db = fakeDb(0, 2);
    const report = vi.fn();
    await expect(runMigrationDataCheck({ db, report })).resolves.toBe(2);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('INCOMPLETE_DATA'));
    expect(db.$disconnect).toHaveBeenCalledOnce();
  });

  it('also catches a zero-version product even if a snapshot row exists', async () => {
    const db = fakeDb(1, 0);
    await expect(runMigrationDataCheck({ db, report: vi.fn() })).resolves.toBe(2);
  });

  it('does not mistake an empty catalogue for proof the backfill ran', async () => {
    const db = fakeDb(0, 0, 0);
    const report = vi.fn();
    await expect(runMigrationDataCheck({ db, report })).resolves.toBe(0);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('no rows to verify'));
  });

  it('reports query failure and disconnects without claiming healthy data', async () => {
    const db = fakeDb(0, 0);
    db.product.count.mockReset().mockRejectedValue(new Error('unavailable'));
    const report = vi.fn();
    await expect(runMigrationDataCheck({ db, report })).resolves.toBe(1);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('CHECK_FAILED'));
    expect(db.$disconnect).toHaveBeenCalledOnce();
  });

  it('fails when cleanup fails instead of reporting a successful run', async () => {
    const db = fakeDb(0, 0);
    db.$disconnect.mockRejectedValue(new Error('connection cleanup failed'));
    const report = vi.fn();
    await expect(runMigrationDataCheck({ db, report })).resolves.toBe(1);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('disconnect failed'));
  });
});
