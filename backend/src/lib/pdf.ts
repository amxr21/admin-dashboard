import PDFDocument from 'pdfkit';

import type { CsvColumn } from './csv.js';

/**
 * Rows of already-serialised values to a PDF document buffer — a simple
 * ruled table (title, optional subtitle, header row, data rows), reusing
 * the same `{header, value}` column shape `toCsv`/`toXlsx` take.
 *
 * ─── WHY A HAND-ROLLED TABLE, NOT A LIBRARY'S TABLE HELPER ────────────
 * PDFKit has no built-in table layout; every "PDF table" recipe is
 * hand-rolled column-width math. This is deliberately plain (fixed columns,
 * no cell wrapping, no pagination beyond PDFKit's own page-break-on-overflow
 * default) — a report export needs to be readable, not a print-quality
 * financial statement.
 *
 * ─── COLUMN WIDTHS ─────────────────────────────────────────────────────
 * Split evenly across the page width. A report with many columns (more than
 * ~6) will look cramped — acceptable for now since every report registered
 * in `REPORT_REGISTRY` has 3-5 CSV columns; revisit if a wider report is
 * ever added to the registry.
 */
export function toPdf<T>(
  title: string,
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
  options: { subtitle?: string } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: columns.length > 4 ? 'landscape' : 'portrait' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).font('Helvetica-Bold').text(title);
    if (options.subtitle) {
      doc.moveDown(0.2).fontSize(10).font('Helvetica').fillColor('#666666').text(options.subtitle);
      doc.fillColor('#000000');
    }
    doc.moveDown(0.8);

    const startX = doc.page.margins.left;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = usableWidth / columns.length;
    const rowHeight = 20;

    function drawRow(values: readonly string[], y: number, isHeader: boolean): void {
      doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      values.forEach((value, index) => {
        doc.text(value, startX + index * colWidth, y, {
          width: colWidth - 6,
          ellipsis: true,
          lineBreak: false,
        });
      });
    }

    let y = doc.y;
    drawRow(columns.map((c) => c.header), y, true);
    y += rowHeight;
    doc
      .moveTo(startX, y - 4)
      .lineTo(startX + usableWidth, y - 4)
      .strokeColor('#cccccc')
      .stroke();

    for (const row of rows) {
      if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      drawRow(
        columns.map((c) => String(c.value(row))),
        y,
        false,
      );
      y += rowHeight;
    }

    if (rows.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor('#666666').text('No data in this range.', startX, y);
    }

    doc.end();
  });
}
