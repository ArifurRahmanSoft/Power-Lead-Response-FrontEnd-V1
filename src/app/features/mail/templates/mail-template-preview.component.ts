import { Component, Input, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize, map } from 'rxjs/operators';

import { PERMISSIONS } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import { Lead } from '../../leads/models/lead.models';
import { LeadsService } from '../../leads/services/leads.service';
import {
  MailTemplateAsset,
  MailTemplatePreview,
  PlaceholderDefinition,
} from '../models/mail-template.models';
import { mailTemplateErrorDetails } from '../mail-template-errors';
import { MailTemplatesService } from '../services/mail-templates.service';
import { addAssetDisplaySources, buildPreviewDocument, formatBytes } from './mail-template-utils';

@Component({
  selector: 'app-mail-template-preview',
  imports: [FormsModule],
  templateUrl: './mail-template-preview.component.html',
  styleUrl: './mail-template-preview.component.css',
})
export class MailTemplatePreviewComponent implements OnInit, OnDestroy {
  @Input({ required: true }) templateId = '';
  @Input() version?: number;

  private readonly templates = inject(MailTemplatesService);
  private readonly leadsService = inject(LeadsService);
  private readonly auth = inject(AuthService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly placeholders = signal<PlaceholderDefinition[]>([]);
  protected readonly leads = signal<Lead[]>([]);
  protected readonly attachments = signal<MailTemplateAsset[]>([]);
  protected readonly preview = signal<MailTemplatePreview | null>(null);
  protected readonly safeDocument = signal<SafeHtml | null>(null);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected mode: 'sample' | 'lead' = 'sample';
  protected leadId = '';
  protected sampleValues: Record<string, string> = {};
  protected readonly formatBytes = formatBytes;
  private objectUrls: string[] = [];

  ngOnInit(): void {
    this.templates.placeholders().subscribe({
      next: ({ data }) => {
        this.placeholders.set(data);
        this.sampleValues = Object.fromEntries(data.map(({ key }) => [key, '']));
      },
      error: (error) =>
        this.errorMessage.set(
          mailTemplateErrorDetails(error, 'Unable to load template variables.').message,
        ),
    });
    this.templates.get(this.templateId, this.version).subscribe({
      next: ({ data }) =>
        this.attachments.set(data.assets.filter((asset) => asset.kind === 'attachment')),
      error: () => undefined,
    });
    if (this.auth.hasAnyPermission([PERMISSIONS.leadsView, PERMISSIONS.leadsRead])) {
      this.leadsService.list(1, 100, {}).subscribe({
        next: ({ data }) => this.leads.set(data.items),
        error: () => this.leads.set([]),
      });
    }
    this.render();
  }

  protected setSampleValue(key: string, event: Event): void {
    this.sampleValues = {
      ...this.sampleValues,
      [key]: (event.target as HTMLInputElement).value,
    };
  }

  protected render(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.safeDocument.set(null);
    this.revokeObjectUrls();
    const request =
      this.mode === 'lead'
        ? { lead_id: this.leadId || undefined, version: this.version }
        : {
            sample_values: Object.fromEntries(
              Object.entries(this.sampleValues).map(([key, value]) => [key, value || null]),
            ),
            version: this.version,
          };
    this.templates
      .preview(this.templateId, request)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ data }) => {
          this.preview.set(data);
          this.hydratePreview(data);
        },
        error: (error) =>
          this.errorMessage.set(
            mailTemplateErrorDetails(error, 'Unable to render this preview.').message,
          ),
      });
  }

  private hydratePreview(preview: MailTemplatePreview): void {
    const entries = Object.entries(preview.asset_urls);
    if (!entries.length) {
      this.setPreviewDocument(preview.rendered_html);
      return;
    }
    forkJoin(
      entries.map(([id, url]) =>
        this.templates.assetContent(url).pipe(
          map((blob) => [id, URL.createObjectURL(blob)] as const),
          catchError(() => of([id, ''] as const)),
        ),
      ),
    ).subscribe((sources) => {
      const usable = sources.filter((entry) => entry[1]);
      this.objectUrls.push(...usable.map((entry) => entry[1]));
      this.setPreviewDocument(addAssetDisplaySources(preview.rendered_html, new Map(usable)));
    });
  }

  private setPreviewDocument(html: string): void {
    const document = buildPreviewDocument(html);
    this.safeDocument.set(this.sanitizer.bypassSecurityTrustHtml(document));
  }

  ngOnDestroy(): void {
    this.revokeObjectUrls();
  }

  private revokeObjectUrls(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }
}
