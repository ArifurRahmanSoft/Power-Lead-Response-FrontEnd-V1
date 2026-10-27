import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';

import { API_CONFIG } from '../../../core/config/api.config';
import { PermissionKey, PERMISSIONS } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import { ContactStage } from '../../mail/models/outbound-message.models';
import { SmsBatchData } from '../models/sms.models';
import { SendSmsComponent } from './send-sms.component';

interface ExposedSendSms {
  composeForm: FormGroup<{
    templateId: FormControl<string>;
    contactType: FormControl<ContactStage>;
  }>;
  openComposer(): void;
  send(): void;
  resolveSubmission(): void;
  refreshStatus(): void;
  uncertainSubmission(): boolean;
  checkingResult(): boolean;
}

const templatePage = {
  success: true,
  data: {
    items: [
      {
        id: 'template-1',
        tenant_id: 'tenant-1',
        category: 'message',
        name: 'Initial SMS',
        body: 'Hi {{first_name}}',
        archived: false,
        created_by_user_id: 'user-1',
        updated_by_user_id: 'user-1',
        archived_by_user_id: null,
        created_at: '2026-10-18T00:00:00Z',
        updated_at: '2026-10-18T00:00:00Z',
        archived_at: null,
      },
    ],
    page: 1,
    size: 100,
    total: 1,
  },
};

function batch(status = 'completed'): SmsBatchData {
  return {
    batch_id: 'batch-1',
    status,
    selection_count: 2,
    contact_type: 'initial',
    accepted_count: 1,
    queued_count: 0,
    sent_count: 0,
    delivered_count: 0,
    failed_count: 0,
    undelivered_count: 0,
    unknown_count: 0,
    skipped_count: 1,
    replayed: false,
    recipients: [
      {
        requested_lead_id: 'lead-1',
        lead_id: 'lead-1',
        message_id: 'message-1',
        status: 'accepted',
        provider_message_sid: 'SM1',
        reason_code: null,
        reason: null,
        warnings: [],
      },
      {
        requested_lead_id: 'lead-2',
        lead_id: 'lead-2',
        message_id: null,
        status: 'skipped',
        provider_message_sid: null,
        reason_code: 'invalid_phone',
        reason: 'Phone must use international E.164 format',
        warnings: [],
      },
    ],
  };
}

describe('SendSmsComponent', () => {
  let fixture: ComponentFixture<SendSmsComponent>;
  let component: ExposedSendSms;
  let http: HttpTestingController;
  let permissions: Set<PermissionKey>;

  beforeEach(() => {
    permissions = new Set([
      PERMISSIONS.mailSend,
      PERMISSIONS.mailView,
      PERMISSIONS.mailTemplatesView,
    ]);
    TestBed.configureTestingModule({
      imports: [SendSmsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { hasPermission: (permission: PermissionKey) => permissions.has(permission) },
        },
      ],
    });
    fixture = TestBed.createComponent(SendSmsComponent);
    fixture.componentInstance.recipients = [
      { id: 'lead-1', name: 'Initial Lead', phone: '+14155552671' },
      { id: 'lead-2', name: 'Skipped Lead', phone: '01700000000' },
    ];
    fixture.componentInstance.recipientCount = 2;
    component = fixture.componentInstance as unknown as ExposedSendSms;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function openWithTemplates(): void {
    component.openComposer();
    http.expectOne(`${API_CONFIG.baseUrl}/message-templates?page=1&size=100`).flush(templatePage);
    fixture.detectChanges();
  }

  it('sends only the supplied lead IDs with template, contact type, and an idempotency key', () => {
    openWithTemplates();
    component.composeForm.controls.contactType.setValue('follow_up');

    component.send();

    const pending = http.expectOne(`${API_CONFIG.baseUrl}/sms/send`);
    expect(pending.request.body).toEqual({
      lead_ids: ['lead-1', 'lead-2'],
      message_template_id: 'template-1',
      contact_type: 'follow_up',
      idempotency_key: expect.stringMatching(/^sms-/),
    });
    pending.flush({ success: true, message: 'SMS send completed', data: batch() });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Initial — Accepted');
    expect(text).toContain('Initial — Skipped');
    expect(text).toContain('Phone must use international E.164 format');
    expect(text).toContain('0Delivered');
  });

  it('recovers an in-progress operation with GET and the original idempotency key', () => {
    openWithTemplates();
    component.send();
    const first = http.expectOne(`${API_CONFIG.baseUrl}/sms/send`);
    const firstKey = first.request.body.idempotency_key;
    first.flush('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' });
    expect(component.uncertainSubmission()).toBe(true);

    component.resolveSubmission();
    expect(component.checkingResult()).toBe(true);
    http.expectNone(`${API_CONFIG.baseUrl}/sms/send`);
    const resolution = http.expectOne(
      (request) =>
        request.url === `${API_CONFIG.baseUrl}/sms/operations/recover` &&
        request.params.get('idempotency_key') === firstKey,
    );
    expect(resolution.request.method).toBe('GET');
    expect(resolution.request.body).toBeNull();
    const processing = batch('processing');
    processing.replayed = true;
    processing.recipients[0] = { ...processing.recipients[0], status: 'queued' };
    resolution.flush({
      success: true,
      message: 'SMS operation is still in progress',
      data: {
        idempotency_key: firstKey,
        found: true,
        operation_state: 'in_progress',
        batch: processing,
      },
    });
    fixture.detectChanges();

    expect(component.uncertainSubmission()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('still processing');
    expect(fixture.nativeElement.textContent).toMatch(/Initial\s+—\s+Queued/);
  });

  it('explains a missing recovery record without assuming the provider was not called', () => {
    openWithTemplates();
    component.send();
    const first = http.expectOne(`${API_CONFIG.baseUrl}/sms/send`);
    const firstKey = first.request.body.idempotency_key;
    first.flush('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' });

    component.resolveSubmission();
    http.expectNone(`${API_CONFIG.baseUrl}/sms/send`);
    http
      .expectOne(
        (request) =>
          request.url === `${API_CONFIG.baseUrl}/sms/operations/recover` &&
          request.params.get('idempotency_key') === firstKey,
      )
      .flush({
        success: true,
        message: 'No SMS operation exists for this idempotency key',
        data: {
          idempotency_key: firstKey,
          found: false,
          operation_state: 'missing',
          batch: null,
        },
      });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(component.uncertainSubmission()).toBe(false);
    expect(text).toContain('No persisted SMS operation was found');
    expect(text).toContain('does not prove that no provider request occurred');
    expect(text).toContain('Send to 2 Leads');
    http.expectNone(`${API_CONFIG.baseUrl}/sms/send`);

    component.send();
    const explicitNewSend = http.expectOne(`${API_CONFIG.baseUrl}/sms/send`);
    expect(explicitNewSend.request.body.idempotency_key).not.toBe(firstKey);
    explicitNewSend.flush({ success: true, message: 'SMS send completed', data: batch() });
  });

  it('displays completed batch and recipient results recovered by GET', () => {
    openWithTemplates();
    component.send();
    const first = http.expectOne(`${API_CONFIG.baseUrl}/sms/send`);
    const firstKey = first.request.body.idempotency_key;
    first.flush('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' });

    component.resolveSubmission();
    const completed = batch();
    completed.replayed = true;
    http
      .expectOne(
        (request) =>
          request.url === `${API_CONFIG.baseUrl}/sms/operations/recover` &&
          request.params.get('idempotency_key') === firstKey,
      )
      .flush({
        success: true,
        message: 'Existing SMS operation returned',
        data: {
          idempotency_key: firstKey,
          found: true,
          operation_state: 'completed',
          batch: completed,
        },
      });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('completed SMS operation was recovered');
    expect(text).toContain('Accepted');
    expect(text).toContain('Phone must use international E.164 format');
    http.expectNone(`${API_CONFIG.baseUrl}/sms/send`);
  });

  it('shows definitive configuration failures without offering uncertain recovery', () => {
    openWithTemplates();
    component.send();
    http
      .expectOne(`${API_CONFIG.baseUrl}/sms/send`)
      .flush(
        { detail: 'Twilio SMS is not configured' },
        { status: 503, statusText: 'Service Unavailable' },
      );
    fixture.detectChanges();

    expect(component.uncertainSubmission()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('HTTP 503: Twilio SMS is not configured');
    expect(fixture.nativeElement.textContent).not.toContain('Check Result');
  });

  it('shows actionable backend validation details for a definitive 422', () => {
    openWithTemplates();
    component.send();
    http
      .expectOne(`${API_CONFIG.baseUrl}/sms/send`)
      .flush(
        { detail: [{ loc: ['body', 'lead_ids'], msg: 'List should have at most 10 items' }] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    fixture.detectChanges();

    expect(component.uncertainSubmission()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain(
      'HTTP 422: lead ids: List should have at most 10 items',
    );
  });

  it('refreshes message status explicitly and reloads backend batch counts', () => {
    openWithTemplates();
    component.send();
    http
      .expectOne(`${API_CONFIG.baseUrl}/sms/send`)
      .flush({ success: true, message: 'SMS send completed', data: batch() });

    component.refreshStatus();
    http
      .expectOne(`${API_CONFIG.baseUrl}/sms/messages/message-1/refresh-status`)
      .flush({ success: true, refreshed: true, data: { id: 'message-1', status: 'delivered' } });
    const refreshed = { ...batch(), accepted_count: 0, delivered_count: 1 };
    refreshed.recipients = [
      { ...refreshed.recipients[0], status: 'delivered' },
      refreshed.recipients[1],
    ];
    http
      .expectOne(`${API_CONFIG.baseUrl}/sms/batches/batch-1`)
      .flush({ success: true, message: 'SMS batch status', data: refreshed });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Initial — Delivered');
  });

  it('explains missing template permission without requesting templates', () => {
    permissions.delete(PERMISSIONS.mailTemplatesView);
    component.openComposer();
    fixture.detectChanges();

    http.expectNone(`${API_CONFIG.baseUrl}/message-templates?page=1&size=100`);
    expect(fixture.nativeElement.textContent).toContain('not permission to view Message Templates');
  });
});
