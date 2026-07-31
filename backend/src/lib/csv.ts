/**
 * Rows of already-serialised values to a CSV string.
 *
 * RFC 4126-shaped: a field is quoted whenever it contains a comma, a quote or
 * a newline, and an embedded quote is doubled. Values arrive as strings (or
 * numbers) already formatted by the caller — this function only handles the
 * CSV escaping, never number/date formatting, so a report's CSV and JSON
 * outputs are guaranteed to agree.
 */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

function escapeCell(value: string | number): string {
  const text = String(value);

  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((column) => escapeCell(column.header)).join(',');

  const lines = rows.map((row) =>
    columns.map((column) => escapeCell(column.value(row))).join(','),
  );

  // CRLF, the RFC-recommended line ending, and a trailing one so the file
  // ends cleanly for tools that read line-by-line.
  return [header, ...lines].join('\r\n') + '\r\n';
}
