'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EXPORT_FORMATS, downloadReport, type DateRange, type ExportFormat, type ReportView } from '@/lib/reports-api';

/**
 * The export control every report view shares (C3.4) — CSV, XLSX or PDF, all
 * three reading the same rows/columns on the backend (`sendExport` in
 * `reports.route.ts`), so which format a user picks never changes what's IN
 * the file, only how it's packaged.
 */
interface ExportButtonProps {
  view: ReportView;
  range: DateRange;
  extra?: Record<string, string | number | undefined>;
  onError: (message: string) => void;
}

export function ExportButton({ view, range, extra, onError }: ExportButtonProps) {
  const t = useTranslations('reports');
  const [format, setFormat] = useState<ExportFormat | null>(null);

  async function run(nextFormat: ExportFormat) {
    setFormat(nextFormat);
    try {
      await downloadReport(view, range, nextFormat, extra);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setFormat(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={format !== null}>
          <Download className="size-4" aria-hidden />
          {t('export')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {EXPORT_FORMATS.map((option) => (
          <DropdownMenuItem key={option} disabled={format !== null} onSelect={() => void run(option)}>
            {t(`exportFormats.${option}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
