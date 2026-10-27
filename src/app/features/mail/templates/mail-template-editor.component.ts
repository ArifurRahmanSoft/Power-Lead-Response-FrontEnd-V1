import { Location } from '@angular/common';
import { HttpEventType } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, forkJoin, of, switchMap } from 'rxjs';
import { catchError, finalize, map } from 'rxjs/operators';

import { PendingChangesAware } from '../../../core/guards/pending-changes.guard';
import { PERMISSIONS } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import {
  ATTACHMENT_ACCEPT,
  ApiDataResponse,
  INLINE_IMAGE_ACCEPT,
  MAIL_TEMPLATE_LIMITS,
  MailTemplate,
  MailTemplateAsset,
  MailTemplateAssetKind,
  MailTemplateCreateRequest,
  PlaceholderDefinition,
} from '../models/mail-template.models';
import { mailTemplateErrorDetails } from '../mail-template-errors';
import { MailTemplatesService } from '../services/mail-templates.service';
import { MailRichTextEditorComponent } from './mail-rich-text-editor.component';
import { MailTemplatePreviewComponent } from './mail-template-preview.component';
import {
  addAssetDisplaySources,
  fileUploadError,
  formatBytes,
  insertAtCursor,
  prepareTemplateHtmlForSave,
  removeAssetFromHtml,
  unknownTemplatePlaceholders,
} from './mail-template-utils';

type InsertionTarget = 'subject' | 'body' | 'signature';
type ImageTarget = 'body' | 'signature';

function htmlContent(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value || '');
  if (/<img\b[^>]*data-asset-id=/i.test(value)) return null;
  const text = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return text ? null : { contentRequired: true };
}

@Component({
  selector: 'app-mail-template-editor',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MailRichTextEditorComponent,
    MailTemplatePreviewComponent,
  ],
  templateUrl: './mail-template-editor.component.html',
  styleUrl: './mail-template-editor.component.css',
})
export class MailTemplateEditorComponent implements OnInit, OnDestroy, PendingChangesAware {
  private readonly templates = inject(MailTemplatesService);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  protected readonly permissions = PERMISSIONS;

  @ViewChild('subjectInput') private subjectInput?: ElementRef<HTMLInputElement>;
  @ViewChild('bodyEditor') private bodyEditor?: MailRichTextEditorComponent;
  @ViewChild('signatureEditor') private signatureEditor?: MailRichTextEditorComponent;
  @ViewChild('imageInput') private imageInput?: ElementRef<HTMLInputElement>;
  @ViewChild('attachmentInput') private attachmentInput?: ElementRef<HTMLInputElement>;

  protected readonly template = signal<MailTemplate | null>(null);
  protected readonly placeholders = signal<PlaceholderDefinition[]>([]);
  protected readonly assets = signal<MailTemplateAsset[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly approving = signal(false);
  protected readonly uploading = signal(false);
  protected readonly uploadProgress = signal(0);
  protected readonly uploadFilename = signal('');
  protected readonly removingAssetId = signal<string | null>(null);
  protected readonly errorMessage = signal('');
  protected readonly notice = signal('');
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly unknownVariables = signal<string[]>([]);
  protected readonly showPreview = signal(false);
  protected activeTarget: InsertionTarget = 'subject';
  protected imageTarget: ImageTarget = 'body';
  protected imageAlt = '';
  protected imageSize = '600';
  protected readonly imageAccept = INLINE_IMAGE_ACCEPT;
  protected readonly attachmentAccept = ATTACHMENT_ACCEPT;
  protected readonly limits = MAIL_TEMPLATE_LIMITS;
  protected readonly formatBytes = formatBytes;

  protected readonly templateForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(120)],
    }),
    subject: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(255)],
    }),
    bodyHtml: new FormControl('', {
      nonNullable: true,
      validators: [htmlContent, Validators.maxLength(200_000)],
    }),
    signatureHtml: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(100_000)],
    }),
    enabled: new FormControl(true, { nonNullable: true }),
  });

  protected templateId = '';
  private objectUrls: string[] = [];
  private readonly assetSources = new Map<string, string>();

  ngOnInit(): void {
    this.templateId = this.route.snapshot.paramMap.get('id') || '';
    this.templates.placeholders().subscribe({
      next: ({ data }) => {
        this.placeholders.set(data);
        this.validateVariables();
      },
      error: (error) =>
        this.errorMessage.set(
          mailTemplateErrorDetails(error, 'Unable to load the variable allowlist.').message,
        ),
    });
    this.templateForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.validateVariables());
    if (this.templateId) this.loadTemplate();
  }

  hasUnsavedChanges(): boolean {
    return this.templateForm.dirty || this.uploading();
  }

  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  protected fieldError(name: keyof typeof this.templateForm.controls): string {
    const control = this.templateForm.controls[name];
    const backendName =
      name === 'bodyHtml' ? 'body_html' : name === 'signatureHtml' ? 'signature_html' : name;
    const backend = this.fieldErrors()[backendName];
    if (backend) return backend;
    if (!control.touched) return '';
    if (control.hasError('required') || control.hasError('contentRequired'))
      return 'This field is required.';
    if (control.hasError('minlength')) return 'Use at least 2 characters.';
    if (control.hasError('maxlength')) return 'This field is longer than the backend limit.';
    return '';
  }

  protected setActiveTarget(target: InsertionTarget): void {
    this.activeTarget = target;
  }

  protected insertVariable(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const key = select.value;
    select.value = '';
    if (!key) return;
    if (this.activeTarget === 'subject') {
      const input = this.subjectInput?.nativeElement;
      const current = this.templateForm.controls.subject.value;
      const insertion = insertAtCursor(
        current,
        `{{${key}}}`,
        input?.selectionStart ?? current.length,
        input?.selectionEnd ?? current.length,
      );
      this.templateForm.controls.subject.setValue(insertion.value);
      requestAnimationFrame(() => {
        input?.focus();
        input?.setSelectionRange(insertion.cursor, insertion.cursor);
      });
      return;
    }
    const editor = this.activeTarget === 'body' ? this.bodyEditor : this.signatureEditor;
    editor?.insertVariable(key);
  }

  protected save(): void {
    this.persistTemplate();
  }

  protected approve(): void {
    if (!this.templateId || this.templateForm.dirty) return;
    this.approving.set(true);
    this.errorMessage.set('');
    this.notice.set('');
    this.templates
      .approve(this.templateId)
      .pipe(finalize(() => this.approving.set(false)))
      .subscribe({
        next: ({ data }) => {
          this.applyTemplate(data);
          this.notice.set(`Version ${data.version} is approved.`);
          this.showPreview.set(false);
        },
        error: (error) => this.applyError(error, 'Unable to approve this template.'),
      });
  }

  protected selectImage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const validation = fileUploadError(file, this.assets(), 'image');
    if (validation) {
      this.errorMessage.set(validation);
      input.value = '';
      return;
    }
    const kind: MailTemplateAssetKind =
      this.imageTarget === 'body' ? 'inline_body' : 'signature_image';
    this.ensureTemplateThen(() => this.upload(file, kind));
  }

  protected selectAttachments(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    if (this.assets().length + files.length > this.limits.maxAssets) {
      this.errorMessage.set('This selection would exceed the limit of 20 assets per version.');
      return;
    }
    const encodedTotal = [
      ...this.assets().map((asset) => asset.size_bytes),
      ...files.map((file) => file.size),
    ].reduce((total, bytes) => total + Math.ceil(bytes / 3) * 4, 4096);
    if (encodedTotal > this.limits.maxEncodedTotalBytes) {
      this.errorMessage.set('This selection may exceed the 25 MiB encoded message limit.');
      return;
    }
    const validation = files
      .map((file) => fileUploadError(file, this.assets(), 'attachment'))
      .find(Boolean);
    if (validation) {
      this.errorMessage.set(validation);
      return;
    }
    this.ensureTemplateThen(() => this.uploadAttachmentQueue(files));
  }

  protected removeAsset(asset: MailTemplateAsset): void {
    if (!this.templateId || this.removingAssetId()) return;
    this.removingAssetId.set(asset.id);
    this.errorMessage.set('');
    const body = removeAssetFromHtml(this.templateForm.controls.bodyHtml.value, asset.id);
    const signature = removeAssetFromHtml(this.templateForm.controls.signatureHtml.value, asset.id);
    const updateFirst: Observable<ApiDataResponse<MailTemplate> | null> =
      asset.kind === 'attachment'
        ? of(null)
        : this.templates.update(this.templateId, {
            body_html: prepareTemplateHtmlForSave(body),
            signature_html: prepareTemplateHtmlForSave(signature),
          });
    updateFirst
      .pipe(
        switchMap((response) => {
          if (response?.data) this.applyTemplate(response.data);
          return this.templates.removeAsset(this.templateId, asset.id);
        }),
        finalize(() => this.removingAssetId.set(null)),
      )
      .subscribe({
        next: () => {
          this.assets.update((items) => items.filter((item) => item.id !== asset.id));
          this.templateForm.patchValue(
            { bodyHtml: body, signatureHtml: signature },
            { emitEvent: false },
          );
          this.templateForm.markAsPristine();
          this.notice.set(`${asset.filename} was removed.`);
          this.showPreview.set(false);
        },
        error: (error) => this.applyError(error, 'Unable to remove this asset.'),
      });
  }

  protected openPreview(): void {
    if (!this.templateId) return;
    this.showPreview.set(!this.showPreview());
  }

  private loadTemplate(): void {
    this.loading.set(true);
    this.templates
      .get(this.templateId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ data }) => this.loadAssetSources(data),
        error: (error) => this.applyError(error, 'Unable to load this mail template.'),
      });
  }

  private loadAssetSources(template: MailTemplate): void {
    const images = template.assets.filter((asset) => asset.kind !== 'attachment');
    if (!images.length) {
      this.applyTemplate(template);
      return;
    }
    forkJoin(
      images.map((asset) =>
        this.templates.assetContent(asset.content_url).pipe(
          map((blob) => [asset.id, URL.createObjectURL(blob)] as const),
          catchError(() => of([asset.id, ''] as const)),
        ),
      ),
    ).subscribe((sources) => {
      for (const [id, url] of sources) {
        if (!url) continue;
        this.assetSources.set(id, url);
        this.objectUrls.push(url);
      }
      this.applyTemplate(template);
    });
  }

  private persistTemplate(onSuccess?: () => void): void {
    this.templateForm.markAllAsTouched();
    this.validateVariables();
    if (this.templateForm.invalid || this.unknownVariables().length) {
      this.errorMessage.set(
        this.unknownVariables().length
          ? 'Fix the unknown or malformed variables before saving.'
          : 'Complete the required fields before saving.',
      );
      return;
    }
    const request = this.requestFromForm();
    this.saving.set(true);
    this.errorMessage.set('');
    this.notice.set('');
    this.fieldErrors.set({});
    const saveRequest = this.templateId
      ? this.templates.update(this.templateId, request)
      : this.templates.create(request);
    saveRequest.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: ({ data }) => {
        const wasApproved = this.template()?.approval_status === 'approved';
        this.templateId = data.id;
        this.applyTemplate(data);
        this.notice.set(
          wasApproved && data.approval_status === 'draft'
            ? `Draft version ${data.version} created from the approved version.`
            : 'Template saved as a draft.',
        );
        this.showPreview.set(false);
        if (!this.route.snapshot.paramMap.get('id')) {
          this.location.replaceState(`/mail/templates/${data.id}/edit`);
        }
        onSuccess?.();
      },
      error: (error) => this.applyError(error, 'Unable to save this template.'),
    });
  }

  private ensureTemplateThen(action: () => void): void {
    if (this.templateId) {
      action();
      return;
    }
    this.persistTemplate(action);
  }

  private uploadAttachmentQueue(files: File[]): void {
    const [file, ...remaining] = files;
    if (!file) return;
    this.upload(file, 'attachment', () => this.uploadAttachmentQueue(remaining));
  }

  private upload(file: File, kind: MailTemplateAssetKind, done?: () => void): void {
    this.uploading.set(true);
    this.uploadProgress.set(0);
    this.uploadFilename.set(file.name);
    this.errorMessage.set('');
    this.templates.uploadAsset(this.templateId, kind, file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.uploadProgress.set(Math.round((event.loaded / event.total) * 100));
        }
        if (event.type !== HttpEventType.Response || !event.body?.data) return;
        const uploaded = event.body.data;
        if (kind !== 'attachment') {
          const source = URL.createObjectURL(file);
          this.assetSources.set(uploaded.id, source);
          this.objectUrls.push(source);
        }
        this.templates.get(this.templateId).subscribe({
          next: ({ data }) => {
            this.applyTemplate(data);
            if (kind !== 'attachment') {
              const editor = kind === 'inline_body' ? this.bodyEditor : this.signatureEditor;
              editor?.insertAsset(
                uploaded.id,
                this.assetSources.get(uploaded.id) || '',
                this.imageAlt.trim(),
                this.imageSize || null,
              );
              this.imageAlt = '';
              this.notice.set('Image uploaded and inserted at the current cursor position.');
              setTimeout(() => this.persistTemplate(), 0);
            } else {
              this.notice.set(`${uploaded.filename} attached.`);
            }
            this.showPreview.set(false);
            this.finishUpload();
            done?.();
          },
          error: (error) => {
            this.applyError(error, 'The file uploaded, but the template could not be refreshed.');
            this.finishUpload();
          },
        });
      },
      error: (error) => {
        this.applyError(error, `Unable to upload ${file.name}.`);
        this.finishUpload();
      },
    });
  }

  private finishUpload(): void {
    this.uploading.set(false);
    this.uploadProgress.set(0);
    this.uploadFilename.set('');
    if (this.imageInput) this.imageInput.nativeElement.value = '';
    if (this.attachmentInput) this.attachmentInput.nativeElement.value = '';
  }

  private requestFromForm(): MailTemplateCreateRequest {
    const value = this.templateForm.getRawValue();
    return {
      name: value.name.trim(),
      subject: value.subject.trim(),
      body_html: prepareTemplateHtmlForSave(value.bodyHtml),
      signature_html: prepareTemplateHtmlForSave(value.signatureHtml),
      enabled: value.enabled,
    };
  }

  private applyTemplate(template: MailTemplate): void {
    this.template.set(template);
    this.assets.set(template.assets);
    this.templateForm.setValue(
      {
        name: template.name,
        subject: template.subject,
        bodyHtml: addAssetDisplaySources(template.body_html, this.assetSources),
        signatureHtml: addAssetDisplaySources(template.signature_html, this.assetSources),
        enabled: template.enabled,
      },
      { emitEvent: false },
    );
    this.templateForm.markAsPristine();
    this.fieldErrors.set({});
    this.unknownVariables.set([]);
  }

  private validateVariables(): void {
    if (!this.placeholders().length) return;
    const value = this.templateForm.getRawValue();
    this.unknownVariables.set(
      unknownTemplatePlaceholders(
        this.placeholders().map((item) => item.key),
        value.subject,
        value.bodyHtml,
        value.signatureHtml,
      ),
    );
  }

  private applyError(error: unknown, fallback: string): void {
    const details = mailTemplateErrorDetails(error, fallback);
    this.errorMessage.set(details.message);
    this.fieldErrors.set(details.fields);
    if (details.unknownPlaceholders.length) {
      this.unknownVariables.set(details.unknownPlaceholders);
    }
  }

  ngOnDestroy(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
  }
}
