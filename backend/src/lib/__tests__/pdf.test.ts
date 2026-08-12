import { describe, expect, it } from 'vitest';

import { toPdf } from '../pdf.js';
import type { CsvColumn } from '../csv.js';

interface Row {
  label: string;
  revenue: string;
}

const columns: CsvColumn<Row>[] = [
  { header: 'Label', value: (r) => r.label },
  { header: 'Revenue', value: (r) => r.revenue },
];

describe('toPdf', () => {
  it('produces a real PDF document', async () => {
    const buffer = await toPdf('Report', [{ label: 'A', revenue: '10.00' }], columns);

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('does not throw for zero rows', async () => {
    const buffer = await toPdf('Empty report', [], columns);

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('paginates rather than throwing when the row count overflows one page', async () => {
    const manyRows: Row[] = Array.from({ length: 200 }, (_, i) => ({ label: `Row ${i}`, revenue: '1.00' }));

    const buffer = await toPdf('Long report', manyRows, columns);

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // A single-page 200-row document would mean rows were silently dropped
    // rather than flowing onto a second page — the doc must have grown.
    const singlePage = await toPdf('One row', [manyRows[0]!], columns);
    expect(buffer.length).toBeGreaterThan(singlePage.length);
  });

  it('switches to landscape for a report with more than 4 columns', async () => {
    const wideColumns: CsvColumn<Row>[] = [
      { header: 'A', value: () => '1' },
      { header: 'B', value: () => '2' },
      { header: 'C', value: () => '3' },
      { header: 'D', value: () => '4' },
      { header: 'E', value: () => '5' },
    ];

    // Landscape A4 is wider than tall; a portrait doc's /MediaBox has the
    // reverse relationship. This is a coarse but real structural check
    // rather than asserting on PDFKit's internal API.
    const buffer = await toPdf('Wide report', [], wideColumns);
    const text = buffer.toString('latin1');
    const mediaBoxMatch = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);

    expect(mediaBoxMatch).not.toBeNull();
    const [, width, height] = mediaBoxMatch!;
    expect(Number(width)).toBeGreaterThan(Number(height));
  });
});
