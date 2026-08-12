import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { toXlsx } from '../xlsx.js';
import type { CsvColumn } from '../csv.js';

interface Row {
  label: string;
  revenue: string;
}

const columns: CsvColumn<Row>[] = [
  { header: 'Label', value: (r) => r.label },
  { header: 'Revenue', value: (r) => r.revenue },
];

async function readBack(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  return workbook.worksheets[0]!;
}

describe('toXlsx', () => {
  it('writes a header row and one row per input row', async () => {
    const buffer = await toXlsx('Sheet', [{ label: 'A', revenue: '10.00' }, { label: 'B', revenue: '20.00' }], columns);
    const sheet = await readBack(buffer);

    expect(sheet.getRow(1).getCell(1).value).toBe('Label');
    expect(sheet.getRow(1).getCell(2).value).toBe('Revenue');
    expect(sheet.getRow(2).getCell(1).value).toBe('A');
    expect(sheet.getRow(3).getCell(1).value).toBe('B');
  });

  it('writes a numeric-looking money value as a STRING, never coerced to a number', async () => {
    // "10.50" losing its trailing zero to Excel's own number formatting
    // would silently disagree with the same report's CSV/JSON output.
    const buffer = await toXlsx('Sheet', [{ label: 'A', revenue: '10.50' }], columns);
    const sheet = await readBack(buffer);

    expect(sheet.getRow(2).getCell(2).value).toBe('10.50');
    expect(typeof sheet.getRow(2).getCell(2).value).toBe('string');
  });

  it('produces an empty sheet (header only) for zero rows, without throwing', async () => {
    const buffer = await toXlsx('Sheet', [], columns);
    const sheet = await readBack(buffer);

    expect(sheet.getRow(1).getCell(1).value).toBe('Label');
    expect(sheet.rowCount).toBe(1);
  });

  it('sanitises a sheet name containing characters Excel forbids', async () => {
    // A report key like "order-value-distribution" is fine, but a title
    // with a slash or brackets would otherwise throw inside ExcelJS.
    const buffer = await toXlsx('Report: [2026] / Q1', [], columns);
    const sheet = await readBack(buffer);

    expect(sheet.name).not.toMatch(/[[\]:*?/\\]/);
  });
});
