import ExcelJS from 'exceljs';

import type { CsvColumn } from './csv.js';

/**
 * Rows of already-serialised values to an XLSX workbook buffer.
 *
 * Reuses the SAME `{header, value}` column shape `toCsv` takes — a report's
 * CSV and XLSX exports are guaranteed to list the same columns in the same
 * order, because they read the same column definitions rather than two
 * hand-maintained lists that could drift apart.
 *
 * Values arrive already formatted by the caller (money as a fixed 2-decimal
 * string, dates as ISO strings) — same "never a second formatting path"
 * discipline as `toCsv`. A numeric-looking string is written as a STRING
 * cell, not coerced to a number, so a revenue column showing "1234.50"
 * cannot silently become 1234.5 (dropping the trailing zero) or get
 * reformatted by Excel's own locale-dependent number rendering.
 */
export async function toXlsx<T>(
  sheetName: string,
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  // Sheet names cannot exceed 31 chars or contain [ ] : * ? / \ — truncate
  // and strip rather than let ExcelJS throw on a report key like
  // "order-value-distribution".
  const safeName = sheetName.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Report';
  const sheet = workbook.addWorksheet(safeName);

  sheet.columns = columns.map((column) => ({ header: column.header, key: column.header }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(columns.map((column) => String(column.value(row))));
  }

  for (const column of sheet.columns) {
    column.width = Math.min(40, Math.max(10, String(column.header ?? '').length + 4));
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
