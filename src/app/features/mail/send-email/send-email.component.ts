import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  Subject,
  catchError,
  finalize,
  forkJoin,
  map,
  of,
  switchMap,
  take,
  takeUntil,
  timer,
} from 'rxjs';

import { PERMISSIONS } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import { leadErrorDetails } from '../../leads/services/lead-errors';
import { MailTemplateAsset, MailTemplateListItem } from '../models/mail-template.models';
import {
  CommunicationPurpose,
  MailContextType,
  OutboundMessage,
  OutboundMessageStatus,
  OutboundPreview,
  OutboundSendRequest,
} from '../models/outbound-message.models';
import { SenderAccount } from '../models/sender-account.models';
import { MailTemplatesService } from '../services/mail-templates.service';
import { OutboundMessagesService } from '../services/outbound-messages.service';
import { SenderAccountsService } from '../services/sender-accounts.service';
import {
  addAssetDisplaySources,
  buildPreviewDocument,
  formatBytes,
} from '../templates/mail-template-utils';

const TERMINAL_STATES: ReadonlySet<OutboundMessageStatus> = new Set([
  'sent',
  'failed',
  'unknown',
  'cancelled',
]);

@Component({
  selector: 'app-send-email',
  imports: [DatePipe, ReactiveFormsModule],
  templateUrl: './send-email.component.html',
  styleUrl: './send-email.component.css',
})
export class SendEmailComponent implements OnDestroy {
  @Input({ required: true }) contextType!: MailContextType;
  @Input({ required: true }) contextId = '';
  @Input({ required: true }) recipient = '';
  @Input() eligibilityIssues: readonly string[] = [];
  @Output() readonly messageChanged = new EventEmitter<OutboundMessage>();

  protected readonly auth = inject(AuthService);
  private readonly sendersService = inject(SenderAccountsService);
  private readonly templatesService = inject(MailTemplatesService);
  private readonly messagesService = inject(OutboundMessagesService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly stopPolling = new Subject<void>();

  protected readonly permissions = PERMISSIONS;
  protected readonly open = signal(false);
  protected readonly optionsLoading = signal(false);
  protected readonly previewing = signal(false);
  protected readonly sending = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly senders = signal<SenderAccount[]>([]);
  protected readonly templates = signal<MailTemplateListItem[]>([]);
  protected readonly preview = signal<OutboundPreview | null>(null);
  protected readonly message = signal<OutboundMessage | null>(null);
  protected readonly safeDocument = signal<SafeHtml | null>(null);
  protected readonly attachments = signal<MailTemplateAsset[]>([]);
  protected readonly inlineAssets = signal<MailTemplateAsset[]>([]);
  protected readonly errorMessage = signal('');
  protected readonly assetNotice = signal('');
  protected readonly uncertainSubmission = signal(false);
  protected readonly polling = signal(false);
  protected readonly pollingLimitReached = signal(false);
  protected readonly confirmed = signal(false);
  protected readonly formatBytes = formatBytes;

  protected readonly purpose = computed<CommunicationPurpose>(() =>
    this.contextType === 'lead' ? 'lead_acquisition' : 'customer_service',
  );
  protected readonly purposeLabel = computed(() =>
    this.purpose() === 'lead_acquisition' ? 'Lead acquisition' : 'Customer service',
  );
  protected readonly canPreview = computed(
    () =>
      !this.optionsLoading() &&
      !this.previewing() &&
      !this.sending() &&
      !this.message() &&
      this.eligibilityIssues.length === 0 &&
      this.composeForm.valid,
  );

  protected readonly composeForm = new FormGroup({
    senderAccountId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    templateKey: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  protected readonly cancellationReason = new FormControl('Cancelled by user', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(2), Validators.maxLength(500)],
  });

  private sendRequest: OutboundSendRequest | null = null;
  private objectUrls: string[] = [];
  private previewHydrationId = 0;

  constructor() {
    this.composeForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.invalidatePreview();
    });
  }

  protected openComposer(): void {
    if (!this.auth.hasPermission(PERMISSIONS.mailSend)) return;
    this.open.set(true);
    this.errorMessage.set('');
    this.loadOptions();
  }

  protected closeComposer(): void {
    if (this.sending() || (this.uncertainSubmission() && !this.message())) return;
    this.stopPolling.next();
    this.polling.set(false);
    this.open.set(false);
    this.composeForm.reset({ senderAccountId: '', templateKey: '' }, { emitEvent: false });
    this.senders.set([]);
    this.templates.set([]);
    this.resetDraft();
  }

  protected requestPreview(): void {
    if (!this.canPreview()) {
      this.composeForm.markAllAsTouched();
      return;
    }
    const selection = this.selectedTemplate();
    if (!selection) return;

    this.previewing.set(true);
    this.errorMessage.set('');
    this.assetNotice.set('');
    this.revokeObjectUrls();
    const request = {
      context_type: this.contextType,
      context_id: this.contextId,
      sender_account_id: this.composeForm.controls.senderAccountId.value,
      template_id: selection.id,
      template_version: selection.version,
      purpose: this.purpose(),
    } as const;

    forkJoin({
      previewResponse: this.messagesService.preview(request),
      templateResponse: this.templatesService.get(selection.id, selection.version),
    })
      .pipe(
        finalize(() => this.previewing.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ previewResponse, templateResponse }) => {
          this.preview.set(previewResponse.data);
          this.confirmed.set(false);
          this.sendRequest = null;
          this.hydratePreview(previewResponse.data, templateResponse.data.assets);
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            leadErrorDetails(error, 'Unable to create the backend email preview.').message,
          ),
      });
  }

  protected setConfirmed(event: Event): void {
    this.confirmed.set((event.target as HTMLInputElement).checked);
  }

  protected send(): void {
    const draft = this.preview();
    if (!draft || !this.confirmed() || this.sending() || this.message()) return;
    this.sendRequest ??= {
      preview_id: draft.preview_id,
      preview_hash: draft.preview_hash,
      idempotency_key: this.createIdempotencyKey(),
    };
    this.submitSendRequest();
  }

  protected resolveUncertainSubmission(): void {
    if (!this.uncertainSubmission() || !this.sendRequest || this.sending()) return;
    this.submitSendRequest();
  }

  protected cancelMessage(): void {
    const current = this.message();
    if (!current || !this.canCancel(current) || this.cancelling()) return;
    this.cancellationReason.markAsTouched();
    if (this.cancellationReason.invalid) return;
    this.cancelling.set(true);
    this.errorMessage.set('');
    this.messagesService
      .cancel(current.id, this.cancellationReason.value.trim())
      .pipe(
        finalize(() => this.cancelling.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.stopPolling.next();
          this.polling.set(false);
          this.setMessage(data);
        },
        error: (error: unknown) => {
          this.errorMessage.set(
            leadErrorDetails(error, 'Unable to cancel this queued email.').message,
          );
          this.refreshMessage(current.id);
        },
      });
  }

  protected canCancel(message: OutboundMessage): boolean {
    return message.status === 'queued' && this.auth.hasPermission(PERMISSIONS.mailCancel);
  }

  protected statusLabel(status: OutboundMessageStatus | string): string {
    if (status === 'queued') return 'Queued — not sent';
    if (status === 'sent') return 'Sent';
    if (status === 'unknown') return 'Unknown — uncertain outcome';
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  protected latestFailureReason(message: OutboundMessage): string {
    const eventReason = [...message.events]
      .reverse()
      .find((event) => event.safe_reason)?.safe_reason;
    return eventReason || message.failure_reason || '';
  }

  private loadOptions(): void {
    this.optionsLoading.set(true);
    forkJoin({
      senders: this.sendersService.list(1, 100, false),
      templates: this.templatesService.list(1, 100, {
        enabled: true,
        approvalStatus: 'approved',
      }),
    })
      .pipe(
        finalize(() => this.optionsLoading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ senders, templates }) => {
          const activeSenders = senders.data.items.filter(
            (sender) => sender.is_active && sender.credentials_configured,
          );
          const approvedTemplates = templates.data.items.filter(
            (template) =>
              template.enabled && !template.archived && template.approval_status === 'approved',
          );
          this.senders.set(activeSenders);
          this.templates.set(approvedTemplates);
          this.composeForm.patchValue(
            {
              senderAccountId:
                activeSenders.find((sender) => sender.is_default)?.id || activeSenders[0]?.id || '',
              templateKey: approvedTemplates[0] ? this.templateKey(approvedTemplates[0]) : '',
            },
            { emitEvent: false },
          );
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            leadErrorDetails(error, 'Unable to load active sender accounts and approved templates.')
              .message,
          ),
      });
  }

  private submitSendRequest(): void {
    if (!this.sendRequest) return;
    this.sending.set(true);
    this.errorMessage.set('');
    this.messagesService
      .send(this.sendRequest)
      .pipe(
        finalize(() => this.sending.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.uncertainSubmission.set(false);
          this.setMessage(data);
          if (!TERMINAL_STATES.has(data.status)) this.startPolling(data.id);
        },
        error: (error: unknown) => {
          if (this.isUncertain(error)) {
            this.uncertainSubmission.set(true);
            this.errorMessage.set(
              'The send outcome is uncertain. Do not create another preview or key. Use “Resolve submission” to safely retry this exact request.',
            );
            return;
          }
          this.errorMessage.set(leadErrorDetails(error, 'Unable to enqueue this email.').message);
          if (error instanceof HttpErrorResponse && error.status === 409) this.invalidatePreview();
        },
      });
  }

  private startPolling(messageId: string): void {
    this.stopPolling.next();
    this.polling.set(true);
    this.pollingLimitReached.set(false);
    timer(2000, 3000)
      .pipe(
        take(8),
        switchMap(() => this.messagesService.get(messageId)),
        takeUntil(this.stopPolling),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.polling.set(false)),
      )
      .subscribe({
        next: ({ data }) => {
          this.setMessage(data);
          if (TERMINAL_STATES.has(data.status)) this.stopPolling.next();
        },
        error: (error: unknown) => {
          this.errorMessage.set(
            leadErrorDetails(error, 'Unable to refresh the current email state.').message,
          );
        },
        complete: () => {
          const current = this.message();
          if (current && !TERMINAL_STATES.has(current.status)) this.pollingLimitReached.set(true);
        },
      });
  }

  private refreshMessage(messageId: string): void {
    this.messagesService
      .get(messageId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: ({ data }) => this.setMessage(data), error: () => undefined });
  }

  private setMessage(message: OutboundMessage): void {
    this.message.set(message);
    this.messageChanged.emit(message);
  }

  private hydratePreview(preview: OutboundPreview, assets: MailTemplateAsset[]): void {
    const hydrationId = ++this.previewHydrationId;
    const referencedIds = this.referencedAssetIds(preview.body_html);
    const inlineAssets = assets.filter(
      (asset) => asset.kind !== 'attachment' && referencedIds.has(asset.id),
    );
    const attachments = assets.filter((asset) => asset.kind === 'attachment');
    this.inlineAssets.set(inlineAssets);
    this.attachments.set(attachments);
    if (
      inlineAssets.length !== preview.inline_asset_count ||
      attachments.length !== preview.attachment_count
    ) {
      this.assetNotice.set(
        'The backend preview counts differ from the visible template metadata. The send snapshot remains authoritative.',
      );
    }
    this.setPreviewDocument(preview.body_html);
    if (!inlineAssets.length) return;
    forkJoin(
      inlineAssets.map((asset) =>
        this.templatesService.assetContent(asset.content_url).pipe(
          map((blob) => [asset.id, URL.createObjectURL(blob)] as const),
          catchError(() => of([asset.id, ''] as const)),
        ),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((sources) => {
        if (hydrationId !== this.previewHydrationId) {
          for (const [, url] of sources) if (url) URL.revokeObjectURL(url);
          return;
        }
        const usable = sources.filter((entry) => entry[1]);
        this.objectUrls.push(...usable.map((entry) => entry[1]));
        this.setPreviewDocument(addAssetDisplaySources(preview.body_html, new Map(usable)));
      });
  }

  private referencedAssetIds(html: string): ReadonlySet<string> {
    if (typeof DOMParser === 'undefined') return new Set();
    const document = new DOMParser().parseFromString(html, 'text/html');
    return new Set(
      Array.from(document.body.querySelectorAll<HTMLElement>('[data-asset-id]'))
        .map((element) => element.dataset['assetId'])
        .filter((id): id is string => Boolean(id)),
    );
  }

  private setPreviewDocument(html: string): void {
    this.safeDocument.set(this.sanitizer.bypassSecurityTrustHtml(buildPreviewDocument(html)));
  }

  private selectedTemplate(): { id: string; version: number } | null {
    const [id, version] = this.composeForm.controls.templateKey.value.split(':');
    const parsedVersion = Number(version);
    return id && Number.isInteger(parsedVersion) && parsedVersion > 0
      ? { id, version: parsedVersion }
      : null;
  }

  protected templateKey(template: MailTemplateListItem): string {
    return `${template.id}:${template.version}`;
  }

  protected invalidatePreview(): void {
    if (this.message() || this.sending() || (this.uncertainSubmission() && this.sendRequest))
      return;
    this.previewHydrationId += 1;
    this.preview.set(null);
    this.safeDocument.set(null);
    this.attachments.set([]);
    this.inlineAssets.set([]);
    this.assetNotice.set('');
    this.confirmed.set(false);
    this.sendRequest = null;
    this.uncertainSubmission.set(false);
    this.revokeObjectUrls();
  }

  private resetDraft(): void {
    this.stopPolling.next();
    this.previewHydrationId += 1;
    this.preview.set(null);
    this.message.set(null);
    this.safeDocument.set(null);
    this.attachments.set([]);
    this.inlineAssets.set([]);
    this.errorMessage.set('');
    this.assetNotice.set('');
    this.confirmed.set(false);
    this.uncertainSubmission.set(false);
    this.pollingLimitReached.set(false);
    this.sendRequest = null;
    this.revokeObjectUrls();
  }

  private createIdempotencyKey(): string {
    const id = globalThis.crypto?.randomUUID?.();
    return id ? `mail-${id}` : `mail-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private isUncertain(error: unknown): boolean {
    return error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500);
  }

  ngOnDestroy(): void {
    this.stopPolling.next();
    this.stopPolling.complete();
    this.revokeObjectUrls();
  }

  private revokeObjectUrls(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }
}
