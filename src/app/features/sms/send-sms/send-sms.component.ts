import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, finalize, forkJoin, map, of, switchMap } from 'rxjs';

import { PERMISSIONS } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import { leadErrorDetails } from '../../leads/services/lead-errors';
import { MessageTemplate } from '../../mail/models/message-template.models';
import { ContactStage } from '../../mail/models/outbound-message.models';
import { MessageTemplatesService } from '../../mail/services/message-templates.service';
import {
  SMS_DIRECT_SEND_MAX_RECIPIENTS,
  SmsBatchData,
  SmsRecipientInput,
  SmsRecipientResult,
  SmsSendRequest,
} from '../models/sms.models';
import { SmsService } from '../services/sms.service';
import { smsSendFailure } from '../sms-send-errors';

const CONTACT_TYPES: readonly ContactStage[] = [
  'initial',
  'follow_up',
  'second_follow_up',
  'final_follow_up',
];
const TERMINAL_BATCH_STATES = new Set(['completed', 'partially_completed', 'cancelled']);

@Component({
  selector: 'app-send-sms',
  imports: [ReactiveFormsModule],
  templateUrl: './send-sms.component.html',
  styleUrl: './send-sms.component.css',
})
export class SendSmsComponent {
  @Input() recipients: readonly SmsRecipientInput[] = [];
  @Input() recipientCount = 0;
  @Output() readonly batchChanged = new EventEmitter<void>();
  @ViewChild('templateSelect') private templateSelect?: ElementRef<HTMLSelectElement>;

  protected readonly auth = inject(AuthService);
  private readonly templatesService = inject(MessageTemplatesService);
  private readonly sms = inject(SmsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly permissions = PERMISSIONS;
  protected readonly batchLimit = SMS_DIRECT_SEND_MAX_RECIPIENTS;
  protected readonly contactTypes = CONTACT_TYPES;
  protected readonly open = signal(false);
  protected readonly loadingTemplates = signal(false);
  protected readonly sending = signal(false);
  protected readonly checkingResult = signal(false);
  protected readonly refreshing = signal(false);
  protected readonly templates = signal<MessageTemplate[]>([]);
  protected readonly batch = signal<SmsBatchData | null>(null);
  protected readonly errorMessage = signal('');
  protected readonly notice = signal('');
  protected readonly uncertainSubmission = signal(false);

  protected readonly composeForm = new FormGroup({
    templateId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    contactType: new FormControl<ContactStage>('initial', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  protected canSend(): boolean {
    return (
      !this.loadingTemplates() &&
      !this.sending() &&
      !this.batch() &&
      !this.uncertainSubmission() &&
      this.recipientCount > 0 &&
      this.recipientCount <= this.batchLimit &&
      this.recipients.length === this.recipientCount &&
      this.composeForm.valid
    );
  }

  private pendingRequest: SmsSendRequest | null = null;
  private opener: HTMLElement | null = null;

  openComposer(): void {
    if (!this.auth.hasPermission(PERMISSIONS.mailSend)) return;
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.reset();
    this.open.set(true);
    if (this.recipientCount > this.batchLimit) {
      this.errorMessage.set(
        `${this.recipientCount} leads are selected; the SMS batch limit is ${this.batchLimit}. Reduce the selection before sending.`,
      );
    } else if (this.recipients.length !== this.recipientCount) {
      this.errorMessage.set(
        'The selected leads could not be resolved safely. Clear the selection and select the intended leads again.',
      );
    }
    this.loadTemplates();
    setTimeout(() => this.templateSelect?.nativeElement.focus());
  }

  protected close(): void {
    if (this.sending() || this.refreshing() || this.uncertainSubmission()) return;
    this.open.set(false);
    setTimeout(() => this.opener?.focus());
  }

  protected send(): void {
    if (!this.canSend()) {
      this.composeForm.markAllAsTouched();
      return;
    }
    const leadIds = Object.freeze(this.recipients.map((recipient) => recipient.id));
    this.pendingRequest = Object.freeze({
      lead_ids: leadIds as string[],
      message_template_id: this.composeForm.controls.templateId.value,
      contact_type: this.composeForm.controls.contactType.value,
      idempotency_key: this.createIdempotencyKey(),
    });
    this.submitPendingRequest();
  }

  protected resolveSubmission(): void {
    if (
      !this.uncertainSubmission() ||
      !this.pendingRequest ||
      this.sending() ||
      this.checkingResult()
    ) {
      return;
    }
    const originalKey = this.pendingRequest.idempotency_key;
    this.checkingResult.set(true);
    this.errorMessage.set('');
    this.notice.set('');
    this.sms
      .recover(originalKey)
      .pipe(
        finalize(() => this.checkingResult.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          if (data.idempotency_key !== originalKey) {
            this.errorMessage.set(
              'The recovery response did not match the original SMS request. No new message was sent. Try Check Result again.',
            );
            return;
          }
          if (data.operation_state === 'missing') {
            this.uncertainSubmission.set(false);
            this.notice.set(
              'No persisted SMS operation was found for the original idempotency key. This does not prove that no provider request occurred. No message was sent automatically; use Send only if you intentionally want to start a new request.',
            );
            return;
          }
          if (!data.batch) {
            this.errorMessage.set(
              'The backend found the SMS operation but did not return its batch results. No new message was sent. Try Check Result again.',
            );
            return;
          }
          this.uncertainSubmission.set(false);
          this.batch.set(data.batch);
          this.notice.set(
            data.operation_state === 'in_progress'
              ? 'The original SMS operation is still processing. No new send was created.'
              : 'The completed SMS operation was recovered. No new send was created.',
          );
          this.batchChanged.emit();
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            `${leadErrorDetails(error, 'Unable to check the SMS result.').message} No new message was sent.`,
          ),
      });
  }

  protected batchInProgress(batch: SmsBatchData): boolean {
    return !TERMINAL_BATCH_STATES.has(batch.status);
  }

  protected refreshStatus(): void {
    const current = this.batch();
    if (!current || this.refreshing() || !this.auth.hasPermission(PERMISSIONS.mailView)) return;
    const messageIds = current.recipients
      .map((recipient) => recipient.message_id)
      .filter((id): id is string => Boolean(id));
    if (!messageIds.length) {
      this.notice.set('No submitted SMS messages are available to refresh.');
      return;
    }
    this.refreshing.set(true);
    this.errorMessage.set('');
    this.notice.set('');
    forkJoin(
      messageIds.map((messageId) =>
        this.sms.refreshStatus(messageId).pipe(
          map(() => true),
          catchError(() => of(false)),
        ),
      ),
    )
      .pipe(
        switchMap((outcomes) =>
          this.sms.getBatch(current.batch_id).pipe(map((response) => ({ outcomes, response }))),
        ),
        finalize(() => this.refreshing.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ outcomes, response }) => {
          this.batch.set(response.data);
          const failed = outcomes.filter((outcome) => !outcome).length;
          this.notice.set(
            failed
              ? `Status refreshed where available; ${failed} ${failed === 1 ? 'message' : 'messages'} could not be refreshed.`
              : 'SMS status refreshed from the backend.',
          );
          this.batchChanged.emit();
        },
        error: (error: unknown) =>
          this.errorMessage.set(leadErrorDetails(error, 'Unable to refresh SMS status.').message),
      });
  }

  protected onModalKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const root = event.currentTarget as HTMLElement;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected contactTypeLabel(value: ContactStage | string): string {
    const labels: Record<ContactStage, string> = {
      initial: 'Initial',
      follow_up: 'Follow-up',
      second_follow_up: 'Second Follow-up',
      final_follow_up: 'Final Follow-up',
    };
    return labels[value as ContactStage] || this.titleCase(value);
  }

  protected statusLabel(value: string): string {
    return this.titleCase(value);
  }

  protected recipientName(recipient: SmsRecipientResult): string {
    return (
      this.recipients.find((item) => item.id === (recipient.lead_id || recipient.requested_lead_id))
        ?.name || 'Selected lead'
    );
  }

  protected recipientPhone(recipient: SmsRecipientResult): string {
    return (
      this.recipients.find((item) => item.id === (recipient.lead_id || recipient.requested_lead_id))
        ?.phone || 'No phone number'
    );
  }

  protected phoneIssue(recipient: SmsRecipientInput): string {
    if (!recipient.phone) return 'Missing phone number';
    return /^\+[1-9]\d{7,14}$/.test(recipient.phone.trim())
      ? ''
      : 'Phone must use international E.164 format';
  }

  protected safeReason(value: string | null): string {
    return (value || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  }

  private loadTemplates(): void {
    if (!this.auth.hasPermission(PERMISSIONS.mailTemplatesView)) {
      this.errorMessage.set(
        'You have SMS send access, but not permission to view Message Templates. Ask an administrator for Message Templates view access.',
      );
      return;
    }
    this.loadingTemplates.set(true);
    this.templatesService
      .list(1, 100)
      .pipe(
        finalize(() => this.loadingTemplates.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          const templates = data.items.filter((template) => !template.archived);
          this.templates.set(templates);
          this.composeForm.controls.templateId.setValue(templates[0]?.id || '');
          if (!templates.length) {
            this.errorMessage.set(
              'No active Message Templates are available. Create or restore a Message Template before sending SMS.',
            );
          }
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            leadErrorDetails(error, 'Unable to load Message Templates.').message,
          ),
      });
  }

  private submitPendingRequest(): void {
    if (!this.pendingRequest) return;
    this.sending.set(true);
    this.errorMessage.set('');
    this.notice.set('');
    this.sms
      .send(this.pendingRequest)
      .pipe(
        finalize(() => {
          this.sending.set(false);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.uncertainSubmission.set(false);
          this.batch.set(data);
          this.notice.set(
            this.batchInProgress(data)
              ? 'Original SMS request recovered. The backend reports that it is still in progress.'
              : data.replayed
                ? 'Existing SMS send result recovered. No new send was created.'
                : 'SMS send completed.',
          );
          this.batchChanged.emit();
        },
        error: (error: unknown) => {
          const failure = smsSendFailure(error);
          if (failure.uncertain) {
            this.uncertainSubmission.set(true);
            this.errorMessage.set(
              `${failure.message} Do not start another send. Check Result will reuse the exact original request and idempotency key.`,
            );
            return;
          }
          this.uncertainSubmission.set(false);
          this.pendingRequest = null;
          this.errorMessage.set(failure.message);
        },
      });
  }

  private reset(): void {
    this.composeForm.reset({ templateId: '', contactType: 'initial' }, { emitEvent: false });
    this.templates.set([]);
    this.batch.set(null);
    this.errorMessage.set('');
    this.notice.set('');
    this.uncertainSubmission.set(false);
    this.checkingResult.set(false);
    this.pendingRequest = null;
  }

  private createIdempotencyKey(): string {
    const id = globalThis.crypto?.randomUUID?.();
    return id ? `sms-${id}` : `sms-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private titleCase(value: string): string {
    return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
}
