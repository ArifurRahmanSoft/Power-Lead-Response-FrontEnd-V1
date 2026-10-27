import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { MailTemplateListItem } from '../models/mail-template.models';
import {
  BulkBatch,
  BulkPreviewPage,
  BulkRecipient,
  BulkSelectionMode,
  ContactStage,
  DirectBatchRecipient,
  DirectBatchSendData,
  DirectBatchSendRequest,
  OutboundMessage,
} from '../models/outbound-message.models';
import { SenderAccount } from '../models/sender-account.models';
import { MailTemplatesService } from '../services/mail-templates.service';
import { OutboundMessagesService } from '../services/outbound-messages.service';
import { SenderAccountsService } from '../services/sender-accounts.service';

const TERMINAL_BATCH_STATES = new Set(['completed', 'partially_completed', 'cancelled']);

interface PendingEmailConflict {
  recipient: DirectBatchRecipient;
  message: OutboundMessage | null;
  loadError: string | null;
}

@Component({
  selector: 'app-bulk-send-email',
  imports: [DatePipe, ReactiveFormsModule],
  templateUrl: './bulk-send-email.component.html',
  styleUrl: './bulk-send-email.component.css',
})
export class BulkSendEmailComponent implements OnChanges, OnDestroy {
  @Input() selectionMode: BulkSelectionMode = 'selected';
  @Input() selectedLeadIds: readonly string[] = [];
  @Input() filters: Readonly<Record<string, string>> = {};
  @Input() recipientCount = 0;
  @Input() selectionRevision = 0;
  @Output() readonly batchChanged = new EventEmitter<void>();

  @ViewChild('firstControl') private firstControl?: ElementRef<HTMLSelectElement>;
  @ViewChild('dialog') private dialog?: ElementRef<HTMLElement>;

  protected readonly auth = inject(AuthService);
  private readonly sendersService = inject(SenderAccountsService);
  private readonly templatesService = inject(MailTemplatesService);
  private readonly messagesService = inject(OutboundMessagesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly stopPolling = new Subject<void>();

  protected readonly permissions = PERMISSIONS;
  protected readonly open = signal(false);
  protected readonly optionsLoading = signal(false);
  protected readonly submitting = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly senders = signal<SenderAccount[]>([]);
  protected readonly templates = signal<MailTemplateListItem[]>([]);
  protected readonly directResult = signal<DirectBatchSendData | null>(null);
  protected readonly pageData = signal<BulkPreviewPage | null>(null);
  protected readonly errorMessage = signal('');
  protected readonly notice = signal('');
  protected readonly uncertainSubmission = signal(false);
  protected readonly pendingEmailConflicts = signal<PendingEmailConflict[]>([]);
  protected readonly conflictsLoading = signal(false);
  protected readonly polling = signal(false);
  protected readonly pollingLimitReached = signal(false);
  private readonly formStateRevision = signal(0);
  private readonly inputStateRevision = signal(0);

  protected readonly composeForm = new FormGroup({
    senderAccountId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    templateKey: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    contactType: new FormControl<ContactStage>('initial', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });
  protected readonly cancellationReason = new FormControl('Cancelled by user', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(2), Validators.maxLength(500)],
  });

  protected readonly batch = computed(() => this.pageData()?.batch ?? null);
  protected readonly resultStatus = computed(
    () => this.batch()?.status ?? this.directResult()?.status ?? null,
  );
  protected readonly recipientPageCount = computed(() => {
    const data = this.pageData();
    return data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  });
  protected readonly sendBlockedReason = computed(() => {
    this.formStateRevision();
    this.inputStateRevision();

    if (this.optionsLoading()) return 'Waiting for sender and template options to finish loading.';
    if (this.recipientCount < 1) return 'Select at least one lead.';
    if (this.selectionMode === 'selected' && this.selectedLeadIds.length < 1)
      return 'The selected lead rows have not reached the email composer.';

    const senderAccountId = this.composeForm.controls.senderAccountId.value;
    if (!senderAccountId) return 'Choose a sender email.';
    if (!this.senders().some((sender) => sender.id === senderAccountId && sender.is_active))
      return 'The selected sender email is no longer active or available.';

    if (!this.composeForm.controls.templateKey.value) return 'Choose an approved mail template.';
    if (!this.selectedTemplate())
      return 'The selected approved template version is no longer available.';
    if (this.composeForm.controls.contactType.invalid) return 'Choose a mail type.';
    if (this.submitting()) return 'The email batch request is being submitted.';
    if (this.uncertainSubmission())
      return 'Resolve the uncertain request before starting another send.';
    return '';
  });
  protected readonly canSend = computed(
    () => !this.sendBlockedReason() && !this.directResult() && !this.pageData(),
  );
  protected readonly allRecipientsSkipped = computed(() => {
    const result = this.directResult();
    return Boolean(
      result && result.selection_count > 0 && result.skipped_count === result.selection_count,
    );
  });
  protected readonly replaceableConflicts = computed(() =>
    this.pendingEmailConflicts().filter(
      ({ recipient, message }) =>
        message !== null &&
        message.status === 'queued' &&
        message.job_id !== null &&
        message.events.every((event) => event.status === 'queued') &&
        !this.replacementAttemptedLeadIds().has(recipient.requested_lead_id),
    ),
  );

  private pendingRequest: DirectBatchSendRequest | null = null;
  private pendingReplacementLeadIds: readonly string[] = [];
  private readonly replacementAttemptedLeadIds = signal<ReadonlySet<string>>(new Set());
  private readonly recipientDetails = new Map<string, BulkRecipient>();
  private lastTrigger: HTMLElement | null = null;
  private lastOpenedSelectionRevision = -1;

  constructor() {
    this.composeForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.formStateRevision.update((revision) => revision + 1);
      if (!this.directResult() && !this.pageData()) this.clearPendingRequest();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.inputStateRevision.update((revision) => revision + 1);
    if (
      this.open() &&
      !this.directResult() &&
      !this.pageData() &&
      (changes['selectionMode'] ||
        changes['selectedLeadIds'] ||
        changes['filters'] ||
        changes['selectionRevision'])
    ) {
      this.clearPendingRequest();
    }
  }

  public openComposer(): void {
    if (!this.auth.hasPermission(PERMISSIONS.mailSend) || this.recipientCount < 1) return;
    if (this.lastOpenedSelectionRevision !== this.selectionRevision) {
      this.resetSession();
      this.lastOpenedSelectionRevision = this.selectionRevision;
    }
    this.lastTrigger =
      typeof document === 'undefined' ? null : (document.activeElement as HTMLElement);
    this.open.set(true);
    this.errorMessage.set('');
    this.notice.set('');
    this.loadOptions();
    setTimeout(() => this.firstControl?.nativeElement.focus());
  }

  protected closeComposer(): void {
    if (this.submitting() || this.uncertainSubmission()) return;
    this.open.set(false);
    this.stopPolling.next();
    this.polling.set(false);
    setTimeout(() => this.lastTrigger?.focus());
  }

  protected resumeBatch(): void {
    this.open.set(true);
    const batchId = this.batch()?.id ?? this.directResult()?.batch_id;
    if (batchId) this.refreshBatch(batchId, !TERMINAL_BATCH_STATES.has(this.resultStatus() || ''));
  }

  protected sendEmails(): void {
    if (!this.canSend()) {
      this.composeForm.markAllAsTouched();
      return;
    }
    if (!this.pendingRequest) this.pendingRequest = this.buildRequest();
    if (!this.pendingRequest) return;
    this.pendingReplacementLeadIds = [];
    this.submitDirect(this.pendingRequest);
  }

  protected resolveSubmission(): void {
    if (!this.pendingRequest || this.submitting()) return;
    this.submitDirect(this.pendingRequest);
  }

  protected replacePendingEmails(): void {
    const leadIds = this.replaceableConflicts().map(
      ({ recipient }) => recipient.lead_id || recipient.requested_lead_id,
    );
    if (!leadIds.length || !this.pendingRequest || this.submitting() || this.uncertainSubmission())
      return;

    this.replacementAttemptedLeadIds.update((attempted) => new Set([...attempted, ...leadIds]));
    this.pendingReplacementLeadIds = leadIds;
    this.pendingRequest = {
      selection_mode: 'selected',
      lead_ids: leadIds,
      sender_account_id: this.pendingRequest.sender_account_id,
      template_id: this.pendingRequest.template_id,
      template_version: this.pendingRequest.template_version,
      contact_type: this.pendingRequest.contact_type,
      supersede_queued: true,
      idempotency_key: this.createIdempotencyKey(),
    };
    this.submitDirect(this.pendingRequest);
  }

  private submitDirect(request: DirectBatchSendRequest): void {
    this.submitting.set(true);
    this.errorMessage.set('');
    this.notice.set('');
    this.messagesService
      .sendBatchDirect(request)
      .pipe(
        finalize(() => this.submitting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data, message }) => {
          const result = this.pendingReplacementLeadIds.length
            ? this.mergeReplacementResult(data, this.pendingReplacementLeadIds)
            : data;
          this.directResult.set(result);
          this.pageData.set(null);
          this.uncertainSubmission.set(false);
          this.notice.set(
            this.allSkipped(result) ? '' : `${message}. ${this.countSummary(result)}.`,
          );
          this.batchChanged.emit();
          this.loadPendingEmailConflicts(result);
          if (this.auth.hasPermission(PERMISSIONS.mailView))
            this.refreshBatch(data.batch_id, false);
        },
        error: (error: unknown) => {
          if (this.isUncertain(error)) {
            this.uncertainSubmission.set(true);
            this.errorMessage.set(
              'The send outcome is uncertain. Resolve this request to reuse the same idempotency key; do not start another send.',
            );
            return;
          }
          this.errorMessage.set(this.directSendErrorMessage(error));
        },
      });
  }

  protected loadRecipientPage(page: number): void {
    const data = this.pageData();
    if (!data || page < 1 || page > Math.ceil(data.total / data.size)) return;
    this.messagesService
      .getBatchRecipients(data.batch.id, page, data.size)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data: next }) => {
          this.pageData.set(next);
          for (const recipient of next.items)
            this.recipientDetails.set(recipient.requested_lead_id, recipient);
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            leadErrorDetails(error, 'Unable to load batch recipients.').message,
          ),
      });
  }

  protected canCancel(batch: BulkBatch): boolean {
    return (
      this.auth.hasPermission(PERMISSIONS.mailCancel) &&
      batch.status !== 'previewed' &&
      batch.queued_count + batch.processing_count > 0
    );
  }

  protected cancelBatch(): void {
    const batch = this.batch();
    if (!batch || !this.canCancel(batch) || this.cancellationReason.invalid || this.cancelling())
      return;
    this.cancelling.set(true);
    this.messagesService
      .cancelBatch(batch.id, this.cancellationReason.value)
      .pipe(
        finalize(() => this.cancelling.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.notice.set(
            `Cancellation processed: ${data.cancelled} cancelled, ${data.in_flight} already in flight, ${data.already_terminal} already finished.`,
          );
          this.batchChanged.emit();
          this.refreshBatch(batch.id, false);
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            leadErrorDetails(error, 'Unable to cancel the email batch.').message,
          ),
      });
  }

  protected statusLabel(status: string | null): string {
    if (!status) return 'Not queued';
    if (status === 'queued') return 'Queued — not sent';
    if (status === 'sent') return 'Sent';
    return status.replaceAll('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase());
  }

  protected outcomeLabel(status: string | null, contactType: ContactStage): string {
    return `${this.contactTypeLabel(contactType)} — ${this.statusLabel(status)}`;
  }

  protected recipientStatus(recipient: BulkRecipient): string {
    return (
      recipient.message_status || (recipient.exclusion_code ? 'skipped' : recipient.preview_status)
    );
  }

  protected recipientOutcomeReason(recipient: BulkRecipient): string | null {
    if (recipient.exclusion_reason) return recipient.exclusion_reason;
    const status = recipient.message_status;
    if (!status) return null;
    const eventReason = [...recipient.events]
      .reverse()
      .find((event) => event.status === status && event.safe_reason)?.safe_reason;
    if (eventReason) return eventReason;
    if (status === 'failed') return 'Delivery failed. This message was not automatically resent.';
    if (status === 'unknown')
      return 'Delivery outcome is uncertain. This message will not be automatically resent.';
    return null;
  }

  protected directOutcomeReason(recipient: DirectBatchRecipient): string | null {
    if (recipient.skip_reason) return recipient.skip_reason;
    const detail = this.recipientDetails.get(recipient.requested_lead_id);
    if (detail) {
      const reason = this.recipientOutcomeReason(detail);
      if (reason) return reason;
    }
    if (recipient.status === 'failed')
      return 'Delivery failed. No additional safe reason was returned.';
    if (recipient.status === 'unknown')
      return 'Delivery outcome is uncertain. This message will not be automatically resent.';
    return null;
  }

  protected directRecipientAddress(recipient: DirectBatchRecipient): string {
    return (
      this.recipientDetails.get(recipient.requested_lead_id)?.recipient_email ||
      recipient.lead_id ||
      recipient.requested_lead_id
    );
  }

  protected resultOutcomeLabel(result: DirectBatchSendData): string {
    if (this.allSkipped(result)) return 'No email sent';
    if (result.unknown_count > 0) return 'Uncertain outcome';
    if (result.failed_count > 0 && result.sent_count === 0) return 'Failed';
    if (result.failed_count > 0 || result.skipped_count > 0) return 'Partially completed';
    if (result.sent_count > 0) return 'Completed';
    return 'Result received';
  }

  protected resultStateClass(result: DirectBatchSendData): string {
    if (this.allSkipped(result)) return 'skipped';
    if (result.unknown_count > 0) return 'unknown';
    if (result.failed_count > 0 && result.sent_count === 0) return 'failed';
    if (result.failed_count > 0 || result.skipped_count > 0) return 'partially_completed';
    return result.sent_count > 0 ? 'completed' : 'processing';
  }

  protected pendingMessageStatus(conflict: PendingEmailConflict): string {
    if (conflict.loadError) return 'Details unavailable';
    return conflict.message ? this.statusLabel(conflict.message.status) : 'No active message found';
  }

  protected recipientTrack(_: number, item: DirectBatchRecipient): string {
    return item.requested_lead_id;
  }

  protected templateKey(template: MailTemplateListItem): string {
    return `${template.id}:${template.version}`;
  }

  private buildRequest(): DirectBatchSendRequest | null {
    const template = this.selectedTemplate();
    if (!template) return null;
    return {
      selection_mode: this.selectionMode,
      ...(this.selectionMode === 'selected'
        ? { lead_ids: [...this.selectedLeadIds] }
        : { filters: { ...this.filters } }),
      sender_account_id: this.composeForm.controls.senderAccountId.value,
      template_id: template.id,
      template_version: template.version,
      contact_type: this.composeForm.controls.contactType.value,
      supersede_queued: false,
      idempotency_key: this.createIdempotencyKey(),
    };
  }

  private loadPendingEmailConflicts(result: DirectBatchSendData): void {
    const conflicts = result.recipients.filter(
      (recipient) =>
        recipient.status === 'skipped' && recipient.skip_code === 'active_send_conflict',
    );
    this.pendingEmailConflicts.set([]);
    if (!conflicts.length || !this.auth.hasPermission(PERMISSIONS.mailView)) return;

    this.conflictsLoading.set(true);
    forkJoin(
      conflicts.map((recipient) => {
        const leadId = recipient.lead_id || recipient.requested_lead_id;
        return this.messagesService.list(1, 100, { leadId }).pipe(
          map(({ data }) => ({
            recipient,
            message:
              data.items.find((message) =>
                ['queued', 'processing', 'unknown'].includes(message.status),
              ) ?? null,
            loadError: null,
          })),
          catchError((error: unknown) =>
            of({
              recipient,
              message: null,
              loadError: leadErrorDetails(error, 'Unable to load the blocking email details.')
                .message,
            }),
          ),
        );
      }),
    )
      .pipe(
        finalize(() => this.conflictsLoading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((details) => this.pendingEmailConflicts.set(details));
  }

  private mergeReplacementResult(
    replacement: DirectBatchSendData,
    replacedLeadIds: readonly string[],
  ): DirectBatchSendData {
    const previous = this.directResult();
    if (!previous) return replacement;
    const targetIds = new Set(replacedLeadIds);
    const replacementByLead = new Map(
      replacement.recipients.map((recipient) => [recipient.requested_lead_id, recipient]),
    );
    const recipients = previous.recipients.map((recipient) =>
      targetIds.has(recipient.requested_lead_id)
        ? replacementByLead.get(recipient.requested_lead_id) || recipient
        : recipient,
    );
    const counts = this.recipientCounts(recipients);
    return {
      ...replacement,
      ...counts,
      selection_count: previous.selection_count,
      recipients,
    };
  }

  private recipientCounts(
    recipients: readonly DirectBatchRecipient[],
  ): Pick<
    DirectBatchSendData,
    | 'queued_count'
    | 'processing_count'
    | 'sent_count'
    | 'failed_count'
    | 'unknown_count'
    | 'skipped_count'
  > {
    const counts = {
      queued_count: 0,
      processing_count: 0,
      sent_count: 0,
      failed_count: 0,
      unknown_count: 0,
      skipped_count: 0,
    };
    for (const recipient of recipients) {
      const key = `${recipient.status}_count` as keyof typeof counts;
      if (key in counts) counts[key] += 1;
    }
    return counts;
  }

  private allSkipped(result: DirectBatchSendData): boolean {
    return result.selection_count > 0 && result.skipped_count === result.selection_count;
  }

  private countSummary(result: DirectBatchSendData): string {
    return `${result.sent_count} sent, ${result.failed_count} failed, ${result.unknown_count} unknown, ${result.skipped_count} skipped`;
  }

  protected contactTypeLabel(contactType: ContactStage): string {
    const labels: Readonly<Record<ContactStage, string>> = {
      initial: 'Initial',
      follow_up: 'Follow-up',
      second_follow_up: 'Second Follow-up',
      final_follow_up: 'Final Follow-up',
    };
    return labels[contactType];
  }

  private directSendErrorMessage(error: unknown): string {
    const fallback = 'Unable to submit the email batch.';
    const message = leadErrorDetails(error, fallback).message;
    if (!(error instanceof HttpErrorResponse) || error.status !== 422) return message;
    const detail = error.error?.detail as
      { message?: unknown; selection_count?: unknown; maximum?: unknown } | undefined;
    if (
      !detail ||
      typeof detail.selection_count !== 'number' ||
      typeof detail.maximum !== 'number'
    ) {
      return message;
    }
    const explanation = typeof detail.message === 'string' ? detail.message : message;
    return `${explanation}: ${detail.selection_count} leads selected; maximum ${detail.maximum}. Select fewer rows or narrow the all-matching filters.`;
  }

  private selectedTemplate(): MailTemplateListItem | null {
    const key = this.composeForm.controls.templateKey.value;
    return (
      this.templates().find(
        (template) =>
          this.templateKey(template) === key &&
          template.enabled &&
          !template.archived &&
          template.approval_status === 'approved' &&
          Number.isInteger(template.version) &&
          template.version > 0,
      ) ?? null
    );
  }

  private loadOptions(): void {
    if (this.senders().length || this.optionsLoading()) return;
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
          this.senders.set(senders.data.items.filter((sender) => sender.is_active));
          this.templates.set(
            templates.data.items.filter(
              (template) =>
                template.enabled && !template.archived && template.approval_status === 'approved',
            ),
          );
          const defaultSender = this.senders().find((sender) => sender.is_default);
          if (defaultSender) this.composeForm.controls.senderAccountId.setValue(defaultSender.id);
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            leadErrorDetails(error, 'Unable to load sender accounts and templates.').message,
          ),
      });
  }

  private startPolling(batchId: string): void {
    this.stopPolling.next();
    this.polling.set(true);
    this.pollingLimitReached.set(false);
    timer(1500, 3000)
      .pipe(
        take(10),
        switchMap(() => this.messagesService.getBatch(batchId)),
        takeUntil(this.stopPolling),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.polling.set(false)),
      )
      .subscribe({
        next: ({ data }) => {
          this.pageData.set(data);
          for (const recipient of data.items)
            this.recipientDetails.set(recipient.requested_lead_id, recipient);
          if (TERMINAL_BATCH_STATES.has(data.batch.status)) {
            this.batchChanged.emit();
            this.stopPolling.next();
          }
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            leadErrorDetails(error, 'Unable to refresh the batch status.').message,
          ),
        complete: () => {
          if (this.batch() && !TERMINAL_BATCH_STATES.has(this.batch()!.status))
            this.pollingLimitReached.set(true);
        },
      });
  }

  private refreshBatch(batchId: string, restartPolling: boolean): void {
    this.messagesService
      .getBatch(batchId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.pageData.set(data);
          for (const recipient of data.items)
            this.recipientDetails.set(recipient.requested_lead_id, recipient);
          if (restartPolling && !TERMINAL_BATCH_STATES.has(data.batch.status))
            this.startPolling(batchId);
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            leadErrorDetails(error, 'Unable to refresh the batch status.').message,
          ),
      });
  }

  private clearPendingRequest(): void {
    this.pendingRequest = null;
    this.pendingReplacementLeadIds = [];
    this.uncertainSubmission.set(false);
  }

  private resetSession(): void {
    this.stopPolling.next();
    this.directResult.set(null);
    this.pageData.set(null);
    this.polling.set(false);
    this.pollingLimitReached.set(false);
    this.pendingEmailConflicts.set([]);
    this.conflictsLoading.set(false);
    this.replacementAttemptedLeadIds.set(new Set());
    this.recipientDetails.clear();
    this.clearPendingRequest();
  }

  private createIdempotencyKey(): string {
    const id = globalThis.crypto?.randomUUID?.();
    return id ? `direct-${id}` : `direct-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private isUncertain(error: unknown): boolean {
    return error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open()) this.closeComposer();
  }

  @HostListener('document:keydown.tab', ['$event'])
  protected trapFocus(event: Event): void {
    if (!this.open() || !this.dialog) return;
    const keyboardEvent = event as KeyboardEvent;
    const focusable = Array.from(
      this.dialog.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (keyboardEvent.shiftKey && document.activeElement === first) {
      keyboardEvent.preventDefault();
      last.focus();
    } else if (!keyboardEvent.shiftKey && document.activeElement === last) {
      keyboardEvent.preventDefault();
      first.focus();
    }
  }

  ngOnDestroy(): void {
    this.stopPolling.next();
    this.stopPolling.complete();
  }
}
