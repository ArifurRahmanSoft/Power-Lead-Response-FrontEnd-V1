import { DatePipe, DOCUMENT, KeyValuePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, forkJoin, of, switchMap, takeWhile, timer } from 'rxjs';

import { IMPORT_CANONICAL_FIELDS, LeadImportBatch, LeadImportRow } from '../../models/lead.models';
import { leadErrorDetails } from '../../services/lead-errors';
import { LeadsService } from '../../services/leads.service';

interface MappingRow {
  source: string;
  target: string;
}

@Component({
  selector: 'app-lead-import',
  imports: [DatePipe, KeyValuePipe, RouterLink],
  templateUrl: './lead-import.component.html',
})
export class LeadImportComponent {
  private readonly leads = inject(LeadsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  protected readonly maxFileBytes = 5 * 1024 * 1024;
  protected readonly maxRows = 5000;
  protected readonly canonicalFields = IMPORT_CANONICAL_FIELDS;
  protected readonly file = signal<File | null>(null);
  protected readonly mappingRows = signal<MappingRow[]>([]);
  protected readonly batch = signal<LeadImportBatch | null>(null);
  protected readonly errors = signal<LeadImportRow[]>([]);
  protected readonly errorPage = signal(1);
  protected readonly errorPageSize = 25;
  protected readonly errorTotal = signal(0);
  protected readonly uploading = signal(false);
  protected readonly committing = signal(false);
  protected readonly downloading = signal(false);
  protected readonly loadingBatch = signal(false);
  protected readonly message = signal('');
  protected readonly confirmOpen = signal(false);

  constructor() {
    const batchId = this.route.snapshot.queryParamMap.get('batch');
    if (batchId) this.recover(batchId);
  }

  protected chooseFile(event: Event): void {
    const selected = (event.target as HTMLInputElement).files?.[0] || null;
    this.message.set('');
    this.batch.set(null);
    this.errors.set([]);
    if (!selected) {
      this.file.set(null);
      return;
    }
    if (!selected.name.toLowerCase().endsWith('.xlsx')) {
      this.message.set('Choose a macro-free .xlsx workbook.');
      (event.target as HTMLInputElement).value = '';
      return;
    }
    if (selected.size > this.maxFileBytes) {
      this.message.set('The file is larger than the configured 5 MB limit.');
      (event.target as HTMLInputElement).value = '';
      return;
    }
    this.file.set(selected);
  }

  protected addMapping(): void {
    this.mappingRows.update((rows) => [...rows, { source: '', target: '' }]);
  }

  protected updateMapping(index: number, field: keyof MappingRow, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.mappingRows.update((rows) =>
      rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
    );
  }

  protected removeMapping(index: number): void {
    this.mappingRows.update((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  }

  protected preview(): void {
    const file = this.file();
    if (!file || this.uploading()) return;
    const mapping: Record<string, string> = {};
    for (const row of this.mappingRows()) {
      const source = row.source.trim();
      if (!source && !row.target) continue;
      if (!source || !row.target) {
        this.message.set('Each header mapping needs both a source header and a target field.');
        return;
      }
      if (mapping[source] || Object.values(mapping).includes(row.target)) {
        this.message.set('Source headers and target fields can each be mapped only once.');
        return;
      }
      mapping[source] = row.target;
    }
    this.uploading.set(true);
    this.message.set('');
    this.leads
      .previewImport(file, mapping)
      .pipe(
        finalize(() => this.uploading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.acceptBatch(data);
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { batch: data.id },
            replaceUrl: true,
          });
        },
        error: (error: unknown) =>
          this.message.set(leadErrorDetails(error, 'Unable to preview this workbook.').message),
      });
  }

  protected commit(): void {
    const batch = this.batch();
    if (!batch || batch.status !== 'previewed' || this.committing()) return;
    this.confirmOpen.set(false);
    this.committing.set(true);
    this.message.set('');
    this.leads
      .commitImport(batch.id)
      .pipe(
        finalize(() => this.committing.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data, message }) => {
          this.acceptBatch(data);
          this.message.set(message || 'Import completed.');
        },
        error: (error: unknown) =>
          this.message.set(leadErrorDetails(error, 'Unable to commit this import.').message),
      });
  }

  protected downloadTemplate(): void {
    if (this.downloading()) return;
    this.downloading.set(true);
    this.leads
      .downloadImportTemplate()
      .pipe(
        finalize(() => this.downloading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (blob) => this.downloadBlob(blob, 'lead-import-template.xlsx'),
        error: (error: unknown) =>
          this.message.set(leadErrorDetails(error, 'Unable to download the template.').message),
      });
  }

  protected loadErrorPage(page: number): void {
    const batch = this.batch();
    const pageCount = Math.max(1, Math.ceil(this.errorTotal() / this.errorPageSize));
    if (!batch || page < 1 || page > pageCount) return;
    this.leads
      .getImportErrors(batch.id, page, this.errorPageSize)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.errors.set(data.items);
          this.errorPage.set(data.page);
          this.errorTotal.set(data.total);
        },
        error: (error: unknown) =>
          this.message.set(leadErrorDetails(error, 'Unable to load row errors.').message),
      });
  }

  protected downloadErrorReport(): void {
    const batch = this.batch();
    if (!batch || !this.errorTotal() || this.downloading()) return;
    this.downloading.set(true);
    this.leads
      .getImportErrors(batch.id, 1, 100)
      .pipe(
        switchMap(({ data }) => {
          const pages = Math.ceil(data.total / 100);
          if (pages <= 1) return forkJoin([of(data.items)]);
          return forkJoin([
            of(data.items),
            ...Array.from({ length: pages - 1 }, (_, index) =>
              this.leads.getImportErrors(batch.id, index + 2, 100),
            ),
          ]);
        }),
        finalize(() => this.downloading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (parts) => {
          const rows = parts.flatMap((part) => (Array.isArray(part) ? part : part.data.items));
          const escape = (value: string | number | null): string =>
            `"${String(value ?? '').replaceAll('"', '""')}"`;
          const csv = [
            'excel_row,status,field,message,lead_id',
            ...rows.flatMap((row) =>
              row.errors.length
                ? row.errors.map((error) =>
                    [row.row_number, row.status, error.field, error.message, row.lead_id]
                      .map(escape)
                      .join(','),
                  )
                : [[row.row_number, row.status, '', '', row.lead_id].map(escape).join(',')],
            ),
          ].join('\r\n');
          this.downloadBlob(
            new Blob([csv], { type: 'text/csv;charset=utf-8' }),
            `lead-import-${batch.id}-errors.csv`,
          );
        },
        error: (error: unknown) =>
          this.message.set(leadErrorDetails(error, 'Unable to build the error report.').message),
      });
  }

  protected reset(): void {
    this.file.set(null);
    this.batch.set(null);
    this.errors.set([]);
    this.errorTotal.set(0);
    this.message.set('');
    void this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  protected errorPageCount(): number {
    return Math.max(1, Math.ceil(this.errorTotal() / this.errorPageSize));
  }

  protected fieldLabel(field: string): string {
    const label = field.replaceAll('_', ' ').trim();
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : 'Row';
  }

  private recover(batchId: string): void {
    this.loadingBatch.set(true);
    timer(0, 2000)
      .pipe(
        switchMap(() => this.leads.getImport(batchId)),
        takeWhile(({ data }) => data.status === 'committing', true),
        finalize(() => this.loadingBatch.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => this.acceptBatch(data),
        error: (error: unknown) =>
          this.message.set(leadErrorDetails(error, 'Unable to recover this import batch.').message),
      });
  }

  private acceptBatch(batch: LeadImportBatch): void {
    this.batch.set(batch);
    const count = batch.summary.invalid + batch.summary.duplicate + batch.summary.failed;
    this.errorTotal.set(count);
    if (count) this.loadErrorPage(1);
    else this.errors.set([]);
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const view = this.document.defaultView;
    if (!view) return;
    const url = view.URL.createObjectURL(blob);
    const anchor = this.document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    view.URL.revokeObjectURL(url);
  }
}
