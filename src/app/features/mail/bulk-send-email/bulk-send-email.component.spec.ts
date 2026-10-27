import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';

import { API_CONFIG } from '../../../core/config/api.config';
import { PERMISSIONS, PermissionKey } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import {
  BulkPreviewPage,
  ContactStage,
  DirectBatchSendData,
  OutboundMessage,
} from '../models/outbound-message.models';
import { BulkSendEmailComponent } from './bulk-send-email.component';

const sender = {
  id: 'sender-1',
  display_name: 'Sales',
  sender_email: 'sales@example.com',
  provider: 'custom_smtp',
  authentication_type: 'password',
  smtp_host: 'smtp.example.com',
  smtp_port: 587,
  encryption: 'STARTTLS',
  smtp_username: 'sales@example.com',
  credentials_configured: true,
  reply_to: null,
  is_active: true,
  is_default: true,
  connection_status: 'success',
  last_tested_at: null,
  last_test_message: null,
  created_at: '2026-10-15T04:00:00Z',
  updated_at: '2026-10-15T04:00:00Z',
};

const template = {
  id: 'template-1',
  name: 'Approved',
  enabled: true,
  archived: false,
  version: 2,
  approval_status: 'approved',
  subject: 'Hello',
  updated_at: '2026-10-15T04:00:00Z',
};

function directResult(overrides: Partial<DirectBatchSendData> = {}): DirectBatchSendData {
  return {
    batch_id: 'batch-1',
    status: 'completed',
    selection_count: 2,
    queued_count: 0,
    processing_count: 0,
    sent_count: 1,
    failed_count: 0,
    unknown_count: 0,
    skipped_count: 1,
    pending_worker_job_count: 0,
    contact_type: 'initial',
    replayed: false,
    recipients: [
      {
        requested_lead_id: 'lead-1',
        lead_id: 'lead-1',
        message_id: 'message-1',
        status: 'sent',
        skip_code: null,
        skip_reason: null,
        warnings: [],
      },
      {
        requested_lead_id: 'lead-2',
        lead_id: 'lead-2',
        message_id: null,
        status: 'skipped',
        skip_code: 'not_eligible',
        skip_reason: 'Lead email consent is explicitly denied',
        warnings: [],
      },
    ],
    ...overrides,
  };
}

function queuedMessage(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    id: 'old-message-1',
    job_id: 'old-job-1',
    context_type: 'lead',
    lead_id: 'lead-2',
    customer_id: null,
    purpose: 'lead_acquisition',
    batch_id: null,
    contact_stage: 'initial',
    recipient_email: 'pending@example.com',
    sender: { display_name: 'Sales', sender_email: 'sales@example.com', reply_to: null },
    template_id: 'old-template',
    template_version: 1,
    subject: 'Older pending email',
    status: 'queued',
    created_at: '2026-10-14T04:00:00Z',
    processing_at: null,
    sent_at: null,
    failed_at: null,
    cancelled_at: null,
    failure_reason: null,
    events: [{ status: 'queued', safe_reason: null, occurred_at: '2026-10-14T04:00:00Z' }],
    ...overrides,
  };
}

function batchPage(status: BulkPreviewPage['batch']['status'] = 'queued'): BulkPreviewPage {
  return {
    batch: {
      id: 'batch-1',
      status,
      selection_mode: 'selected',
      selection_count: 2,
      eligible_count: 1,
      blocked_count: 1,
      preview_hash: 'a'.repeat(64),
      expires_at: '2026-10-15T05:00:00Z',
      sender: { display_name: 'Sales', sender_email: 'sales@example.com', reply_to: null },
      template_id: 'template-1',
      template_version: 2,
      contact_stage: 'initial',
      queued_count: status === 'queued' ? 1 : 0,
      processing_count: 0,
      sent_count: status === 'completed' ? 1 : 0,
      failed_count: 0,
      unknown_count: 0,
      cancelled_count: 0,
    },
    items: [
      {
        id: 'recipient-1',
        lead_id: 'lead-1',
        requested_lead_id: 'lead-1',
        recipient_email: 'lead@example.com',
        preview_status: 'eligible',
        exclusion_code: null,
        exclusion_reason: null,
        warnings: [],
        preview_id: null,
        message_id: 'message-1',
        message_status: status === 'completed' ? 'sent' : 'queued',
        subject: 'Hello Lead',
        body_html: null,
        body_text: null,
        events: [],
      },
      {
        id: 'recipient-2',
        lead_id: 'lead-2',
        requested_lead_id: 'lead-2',
        recipient_email: 'denied@example.com',
        preview_status: 'blocked',
        exclusion_code: 'not_eligible',
        exclusion_reason: 'Lead email consent is explicitly denied',
        warnings: [],
        preview_id: null,
        message_id: null,
        message_status: null,
        subject: null,
        body_html: null,
        body_text: null,
        events: [],
      },
    ],
    page: 1,
    size: 20,
    total: 2,
  };
}

interface ExposedBulkComposer {
  open(): boolean;
  pageData: WritableSignal<BulkPreviewPage | null>;
  directResult: WritableSignal<DirectBatchSendData | null>;
  composeForm: FormGroup<{
    senderAccountId: FormControl<string>;
    templateKey: FormControl<string>;
    contactType: FormControl<ContactStage>;
  }>;
  submitting(): boolean;
  uncertainSubmission(): boolean;
  canSend(): boolean;
  sendBlockedReason(): string;
  openComposer(): void;
  sendEmails(): void;
  resolveSubmission(): void;
  replacePendingEmails(): void;
  cancelBatch(): void;
}

describe('BulkSendEmailComponent direct send', () => {
  let fixture: ComponentFixture<BulkSendEmailComponent>;
  let component: ExposedBulkComposer;
  let http: HttpTestingController;
  let permissions: Set<PermissionKey>;

  beforeEach(() => {
    permissions = new Set([PERMISSIONS.mailSend, PERMISSIONS.mailView, PERMISSIONS.mailCancel]);
    TestBed.configureTestingModule({
      imports: [BulkSendEmailComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { hasPermission: (permission: PermissionKey) => permissions.has(permission) },
        },
      ],
    });
    fixture = TestBed.createComponent(BulkSendEmailComponent);
    fixture.componentRef.setInput('selectionMode', 'selected');
    fixture.componentRef.setInput('selectedLeadIds', ['lead-1', 'lead-2']);
    fixture.componentRef.setInput('recipientCount', 2);
    fixture.detectChanges();
    component = fixture.componentInstance as unknown as ExposedBulkComposer;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture.destroy();
    http.verify({ ignoreCancelled: true });
  });

  function openAndFlushOptions(selectTemplate = true): void {
    component.openComposer();
    http
      .expectOne(
        `${API_CONFIG.baseUrl}/mail/sender-accounts?page=1&size=100&include_inactive=false`,
      )
      .flush({ success: true, data: { items: [sender], page: 1, size: 100, total: 1 } });
    http
      .expectOne(
        `${API_CONFIG.baseUrl}/mail/templates?page=1&size=100&enabled=true&approval_status=approved`,
      )
      .flush({ success: true, data: { items: [template], page: 1, size: 100, total: 1 } });
    if (selectTemplate) component.composeForm.controls.templateKey.setValue('template-1:2');
    fixture.detectChanges();
  }

  it('submits the exact selected scope directly without preview or confirmation requests', () => {
    const changes: void[] = [];
    fixture.componentInstance.batchChanged.subscribe(() => changes.push(undefined));
    openAndFlushOptions();

    component.sendEmails();
    const request = http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/send`);
    expect(request.request.body).toEqual({
      selection_mode: 'selected',
      lead_ids: ['lead-1', 'lead-2'],
      sender_account_id: 'sender-1',
      template_id: 'template-1',
      template_version: 2,
      contact_type: 'initial',
      supersede_queued: false,
      idempotency_key: expect.stringMatching(/^direct-/),
    });
    http.expectNone(`${API_CONFIG.baseUrl}/mail/messages/send`);
    http.expectNone(`${API_CONFIG.baseUrl}/mail/batches/preview`);
    expect(http.match((candidate) => candidate.url.includes('/confirm'))).toHaveLength(0);
    request.flush({
      success: true,
      message: 'Direct email processing completed',
      data: directResult(),
    });
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1`).flush({
      success: true,
      data: batchPage(),
    });
    fixture.detectChanges();

    expect(changes).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('1 sent, 0 failed, 0 unknown, 1 skipped');
    expect(fixture.nativeElement.textContent).not.toContain('Queued means accepted');
    expect(fixture.nativeElement.textContent).toContain('Lead email consent is explicitly denied');
  });

  it('submits all matching scope with filters and no lead IDs', () => {
    fixture.componentRef.setInput('selectionMode', 'all_matching');
    fixture.componentRef.setInput('selectedLeadIds', []);
    fixture.componentRef.setInput('filters', { company: 'Acme' });
    fixture.componentRef.setInput('recipientCount', 25);
    fixture.detectChanges();
    openAndFlushOptions();

    component.sendEmails();
    const request = http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/send`);
    expect(request.request.body.selection_mode).toBe('all_matching');
    expect(request.request.body.filters).toEqual({ company: 'Acme' });
    expect(request.request.body.lead_ids).toBeUndefined();
    request.flush({
      success: true,
      message: 'Direct email processing completed',
      data: directResult(),
    });
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1`).flush({
      success: true,
      data: batchPage(),
    });
  });

  it('shows the exact missing prerequisite and enables only after dropdown selection', () => {
    openAndFlushOptions(false);
    expect(component.canSend()).toBe(false);
    expect(component.sendBlockedReason()).toBe('Choose an approved mail template.');

    component.composeForm.controls.templateKey.setValue('template-1:2');
    fixture.detectChanges();
    expect(component.canSend()).toBe(true);
    expect(component.sendBlockedReason()).toBe('');
    expect(http.match(`${API_CONFIG.baseUrl}/mail/batches/send`)).toHaveLength(0);
  });

  it('prevents duplicate clicks and never sends automatically on selection changes', () => {
    openAndFlushOptions();
    component.composeForm.controls.contactType.setValue('follow_up');
    expect(http.match(`${API_CONFIG.baseUrl}/mail/batches/send`)).toHaveLength(0);

    component.sendEmails();
    component.sendEmails();
    expect(component.submitting()).toBe(true);
    const requests = http.match(`${API_CONFIG.baseUrl}/mail/batches/send`);
    expect(requests).toHaveLength(1);
    requests[0].flush({
      success: true,
      message: 'Direct email processing completed',
      data: directResult(),
    });
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1`).flush({
      success: true,
      data: batchPage(),
    });
  });

  it('reuses the exact request and idempotency key when resolving an uncertain send', () => {
    openAndFlushOptions();
    component.sendEmails();
    const first = http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/send`);
    const firstBody = first.request.body;
    first.error(new ProgressEvent('network error'));
    expect(component.uncertainSubmission()).toBe(true);
    expect(http.match(`${API_CONFIG.baseUrl}/mail/batches/send`)).toHaveLength(0);

    component.resolveSubmission();
    const resolution = http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/send`);
    expect(resolution.request.body).toEqual(firstBody);
    resolution.flush({
      success: true,
      message: 'Existing email batch returned',
      data: directResult({ replayed: true }),
    });
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1`).flush({
      success: true,
      data: batchPage(),
    });
  });

  it('shows the backend batch limit with selected and maximum counts', () => {
    openAndFlushOptions();
    component.sendEmails();
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/send`).flush(
      {
        detail: {
          message: 'Selection exceeds the configured bulk email limit',
          selection_count: 650,
          maximum: 500,
        },
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Selection exceeds the configured bulk email limit: 650 leads selected; maximum 500',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Select fewer rows or narrow the all-matching filters',
    );
  });

  it('keeps contact type separate while displaying sent, failed and unknown outcomes', () => {
    openAndFlushOptions();
    component.directResult.set(
      directResult({
        contact_type: 'follow_up',
        selection_count: 1,
        sent_count: 1,
        skipped_count: 0,
        recipients: [
          {
            requested_lead_id: 'lead-1',
            lead_id: 'lead-1',
            message_id: 'message-1',
            status: 'sent',
            skip_code: null,
            skip_reason: null,
            warnings: [],
          },
        ],
      }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Follow-up — Sent');

    component.directResult.set(
      directResult({
        contact_type: 'follow_up',
        selection_count: 1,
        sent_count: 0,
        failed_count: 1,
        skipped_count: 0,
        recipients: [
          {
            requested_lead_id: 'lead-1',
            lead_id: 'lead-1',
            message_id: 'message-1',
            status: 'failed',
            skip_code: null,
            skip_reason: null,
            warnings: [],
          },
        ],
      }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Follow-up — Failed');

    component.directResult.set(
      directResult({
        contact_type: 'follow_up',
        selection_count: 1,
        sent_count: 0,
        failed_count: 0,
        unknown_count: 1,
        skipped_count: 0,
        recipients: [
          {
            requested_lead_id: 'lead-1',
            lead_id: 'lead-1',
            message_id: 'message-1',
            status: 'unknown',
            skip_code: null,
            skip_reason: null,
            warnings: [],
          },
        ],
      }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Follow-up — Unknown');
    expect(fixture.nativeElement.textContent).toContain(
      'Delivery outcome is uncertain. This message will not be automatically resent.',
    );
  });

  it('shows the backend failure reason returned by the batch record', () => {
    openAndFlushOptions();
    component.composeForm.controls.contactType.setValue('follow_up');
    component.sendEmails();
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/send`).flush({
      success: true,
      message: 'Direct email processing completed',
      data: directResult({
        contact_type: 'follow_up',
        selection_count: 1,
        sent_count: 0,
        failed_count: 1,
        skipped_count: 0,
        recipients: [
          {
            requested_lead_id: 'lead-1',
            lead_id: 'lead-1',
            message_id: 'message-1',
            status: 'failed',
            skip_code: null,
            skip_reason: null,
            warnings: [],
          },
        ],
      }),
    });
    const failedPage = batchPage('partially_completed');
    failedPage.batch.contact_stage = 'follow_up';
    failedPage.batch.sent_count = 0;
    failedPage.batch.failed_count = 1;
    failedPage.items = [
      {
        ...failedPage.items[0],
        message_status: 'failed',
        events: [
          {
            status: 'failed',
            safe_reason: 'Mailbox rejected the message',
            occurred_at: '2026-10-15T04:30:00Z',
          },
        ],
      },
    ];
    failedPage.total = 1;
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1`).flush({
      success: true,
      data: failedPage,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Follow-up — Failed');
    expect(fixture.nativeElement.textContent).toContain('Mailbox rejected the message');
  });

  it('shows no overall success when every recipient is skipped', () => {
    openAndFlushOptions();
    component.sendEmails();
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/send`).flush({
      success: true,
      message: 'No eligible recipients; no SMTP attempts were made',
      data: directResult({
        selection_count: 1,
        sent_count: 0,
        skipped_count: 1,
        recipients: [
          {
            requested_lead_id: 'lead-1',
            lead_id: 'lead-1',
            message_id: null,
            status: 'skipped',
            skip_code: 'not_eligible',
            skip_reason: 'Lead email consent is explicitly denied',
            warnings: [],
          },
        ],
      }),
    });
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1`).flush({
      success: true,
      data: batchPage('completed'),
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No email sent');
    expect(fixture.nativeElement.textContent).toContain(
      'No email was sent. All 1 recipient was skipped.',
    );
    expect(fixture.nativeElement.querySelector('.lead-notice')).toBeNull();
  });

  it('shows an untouched queued blocker and replaces only that lead after explicit action', () => {
    openAndFlushOptions();
    component.sendEmails();
    const initial = http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/send`);
    const initialKey = initial.request.body.idempotency_key;
    initial.flush({
      success: true,
      message: 'Direct email processing completed',
      data: directResult({
        recipients: [
          directResult().recipients[0],
          {
            requested_lead_id: 'lead-2',
            lead_id: 'lead-2',
            message_id: null,
            status: 'skipped',
            skip_code: 'active_send_conflict',
            skip_reason: 'A queued or processing email already exists for this lead',
            warnings: [],
          },
        ],
      }),
    });
    http.expectOne(`${API_CONFIG.baseUrl}/mail/messages?page=1&size=100&lead_id=lead-2`).flush({
      success: true,
      data: { items: [queuedMessage()], page: 1, size: 100, total: 1 },
    });
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1`).flush({
      success: true,
      data: batchPage('completed'),
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Older pending email');
    expect(fixture.nativeElement.textContent).toContain('pending@example.com');
    expect(fixture.nativeElement.textContent).toContain('Replace pending email and send');

    component.replacePendingEmails();
    component.replacePendingEmails();
    const replacementRequests = http.match(`${API_CONFIG.baseUrl}/mail/batches/send`);
    expect(replacementRequests).toHaveLength(1);
    expect(replacementRequests[0].request.body).toEqual({
      selection_mode: 'selected',
      lead_ids: ['lead-2'],
      sender_account_id: 'sender-1',
      template_id: 'template-1',
      template_version: 2,
      contact_type: 'initial',
      supersede_queued: true,
      idempotency_key: expect.stringMatching(/^direct-/),
    });
    expect(replacementRequests[0].request.body.idempotency_key).not.toBe(initialKey);
    replacementRequests[0].flush({
      success: true,
      message: 'Direct email processing completed',
      data: directResult({
        batch_id: 'batch-2',
        selection_count: 1,
        sent_count: 1,
        skipped_count: 0,
        pending_worker_job_count: 0,
        recipients: [
          {
            requested_lead_id: 'lead-2',
            lead_id: 'lead-2',
            message_id: 'message-2',
            status: 'sent',
            skip_code: null,
            skip_reason: null,
            warnings: [
              'An untouched queued email was cancelled as superseded by this direct send.',
            ],
          },
        ],
      }),
    });
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-2`).flush({
      success: true,
      data: batchPage('completed'),
    });
    fixture.detectChanges();

    expect(component.directResult()?.sent_count).toBe(2);
    expect(component.directResult()?.skipped_count).toBe(0);
    expect(fixture.nativeElement.textContent).not.toContain('Replace pending email and send');
  });

  it('does not offer replacement for processing or uncertain messages', () => {
    openAndFlushOptions();
    component.sendEmails();
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/send`).flush({
      success: true,
      message: 'No eligible recipients; no SMTP attempts were made',
      data: directResult({
        selection_count: 1,
        sent_count: 0,
        skipped_count: 1,
        recipients: [
          {
            requested_lead_id: 'lead-2',
            lead_id: 'lead-2',
            message_id: null,
            status: 'skipped',
            skip_code: 'active_send_conflict',
            skip_reason: 'A queued or processing email already exists for this lead',
            warnings: [],
          },
        ],
      }),
    });
    http.expectOne(`${API_CONFIG.baseUrl}/mail/messages?page=1&size=100&lead_id=lead-2`).flush({
      success: true,
      data: {
        items: [
          queuedMessage({
            status: 'processing',
            processing_at: '2026-10-14T04:01:00Z',
            events: [
              { status: 'queued', safe_reason: null, occurred_at: '2026-10-14T04:00:00Z' },
              { status: 'processing', safe_reason: null, occurred_at: '2026-10-14T04:01:00Z' },
            ],
          }),
        ],
        page: 1,
        size: 100,
        total: 1,
      },
    });
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1`).flush({
      success: true,
      data: batchPage('completed'),
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Processing');
    expect(fixture.nativeElement.textContent).toContain('cannot be replaced here');
    expect(fixture.nativeElement.textContent).not.toContain('Replace pending email and send');
    expect(http.match(`${API_CONFIG.baseUrl}/mail/batches/send`)).toHaveLength(0);
  });

  it('keeps permission and cancellation controls on backend-reported active work', () => {
    permissions.delete(PERMISSIONS.mailSend);
    component.openComposer();
    expect(component.open()).toBe(false);

    permissions.add(PERMISSIONS.mailSend);
    component.directResult.set(directResult());
    component.pageData.set(batchPage());
    component.cancelBatch();
    const cancel = http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1/cancel`);
    expect(cancel.request.body.reason).toBe('Cancelled by user');
    cancel.flush({ success: true, data: { cancelled: 1, in_flight: 0, already_terminal: 0 } });
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1`).flush({
      success: true,
      data: batchPage('cancelled'),
    });
  });
});
