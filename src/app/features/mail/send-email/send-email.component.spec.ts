import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { AuthUser, PERMISSIONS, PermissionKey } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import { OutboundMessage } from '../models/outbound-message.models';
import { SendEmailComponent } from './send-email.component';

const user: AuthUser = {
  id: 'user-1',
  login_id: 'owner',
  name: 'Workspace Owner',
  email: 'owner@example.com',
};

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
  reply_to: 'reply@example.com',
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
  name: 'Approved welcome',
  enabled: true,
  archived: false,
  version: 2,
  approval_status: 'approved',
  subject: 'Welcome',
  updated_at: '2026-10-15T04:00:00Z',
};

function message(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    id: 'message-1',
    job_id: 'job-1',
    context_type: 'lead',
    lead_id: 'lead-1',
    customer_id: null,
    purpose: 'lead_acquisition',
    recipient_email: 'lead@example.com',
    sender: { display_name: 'Sales', sender_email: 'sales@example.com', reply_to: null },
    template_id: 'template-1',
    template_version: 2,
    subject: 'Hello Lead',
    status: 'queued',
    created_at: '2026-10-15T04:10:00Z',
    processing_at: null,
    sent_at: null,
    failed_at: null,
    cancelled_at: null,
    failure_reason: null,
    events: [{ status: 'queued', safe_reason: null, occurred_at: '2026-10-15T04:10:00Z' }],
    ...overrides,
  };
}

describe('SendEmailComponent', () => {
  let fixture: ComponentFixture<SendEmailComponent>;
  let http: HttpTestingController;
  let permissions: Set<PermissionKey>;

  beforeEach(() => {
    permissions = new Set([
      PERMISSIONS.mailSend,
      PERMISSIONS.mailView,
      PERMISSIONS.mailCancel,
      PERMISSIONS.mailTemplatesView,
    ]);
    TestBed.configureTestingModule({
      imports: [SendEmailComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            user: signal<AuthUser | null>(user),
            hasPermission: (permission: PermissionKey) => permissions.has(permission),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture?.destroy();
    http.verify();
  });

  function create(contextType: 'lead' | 'customer' = 'lead'): void {
    fixture = TestBed.createComponent(SendEmailComponent);
    fixture.componentRef.setInput('contextType', contextType);
    fixture.componentRef.setInput('contextId', contextType === 'lead' ? 'lead-1' : 'customer-1');
    fixture.componentRef.setInput('recipient', `${contextType}@example.com`);
    fixture.detectChanges();
  }

  function clickButton(text: string): void {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const button = buttons.find((candidate) => candidate.textContent?.trim().includes(text));
    expect(button, `button containing ${text}`).toBeTruthy();
    button?.click();
    fixture.detectChanges();
  }

  function flushOptions(): void {
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
    fixture.detectChanges();
  }

  function createPreview(contextType: 'lead' | 'customer'): void {
    clickButton('Preview email');
    const previewRequest = http.expectOne(`${API_CONFIG.baseUrl}/mail/messages/preview`);
    expect(previewRequest.request.body.context_type).toBe(contextType);
    expect(previewRequest.request.body.purpose).toBe(
      contextType === 'lead' ? 'lead_acquisition' : 'customer_service',
    );
    expect(previewRequest.request.body.recipient).toBeUndefined();
    const contextId = contextType === 'lead' ? 'lead-1' : 'customer-1';
    previewRequest.flush({
      success: true,
      data: {
        preview_id: 'preview-1',
        preview_hash: 'a'.repeat(64),
        expires_at: '2026-10-15T05:00:00Z',
        context_type: contextType,
        context_id: contextId,
        recipient: `${contextType}@example.com`,
        purpose: contextType === 'lead' ? 'lead_acquisition' : 'customer_service',
        sender: { display_name: 'Sales', sender_email: 'sales@example.com', reply_to: null },
        template_id: 'template-1',
        template_version: 2,
        subject: 'Hello Lead',
        body_html: '<p>Hello</p><div class="mail-signature">Regards</div>',
        body_text: 'Hello\nRegards',
        attachment_count: 0,
        inline_asset_count: 0,
      },
    });
    http.expectOne(`${API_CONFIG.baseUrl}/mail/templates/template-1?version=2`).flush({
      success: true,
      data: {
        ...template,
        version_id: 'version-2',
        body_html: '<p>Hello</p>',
        body_text: 'Hello',
        signature_html: '<p>Regards</p>',
        signature_text: 'Regards',
        assets: [],
        approved_at: '2026-10-15T03:00:00Z',
        created_at: '2026-10-15T02:00:00Z',
        version_created_at: '2026-10-15T02:00:00Z',
        version_updated_at: '2026-10-15T03:00:00Z',
      },
    });
    fixture.detectChanges();
  }

  it('previews, requires confirmation, prevents duplicate clicks, and displays queued state', () => {
    create('lead');
    clickButton('Send email');
    flushOptions();
    createPreview('lead');

    expect(fixture.nativeElement.querySelector('iframe[sandbox]')).toBeTruthy();
    const sendButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button: unknown) =>
        (button as HTMLButtonElement).textContent?.includes('Confirm and enqueue'),
    ) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    const checkbox = fixture.nativeElement.querySelector(
      '.send-confirmation input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();
    sendButton.click();
    sendButton.click();

    const requests = http.match(`${API_CONFIG.baseUrl}/mail/messages/send`);
    expect(requests).toHaveLength(1);
    expect(requests[0].request.body.idempotency_key).toMatch(/^mail-/);
    requests[0].flush({ success: true, message: 'Message queued', data: message() });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('message-1');
    expect(fixture.nativeElement.textContent).toContain('Queued');
    expect(fixture.nativeElement.textContent).toContain('Cancel queued email');
  });

  it('uses customer_service for customers and never submits an acquisition purpose', () => {
    create('customer');
    clickButton('Send email');
    flushOptions();
    createPreview('customer');
    expect(fixture.nativeElement.textContent).toContain('Customer service');
    expect(fixture.nativeElement.textContent).not.toContain('Lead acquisition requires');
  });

  it('discards the draft and requires a new backend preview when a selection changes', () => {
    create('lead');
    clickButton('Send email');
    flushOptions();
    createPreview('lead');
    expect(fixture.nativeElement.querySelector('iframe[sandbox]')).toBeTruthy();

    const senderSelect = fixture.nativeElement.querySelector(
      'select[formcontrolname="senderAccountId"]',
    ) as HTMLSelectElement;
    senderSelect.value = '';
    senderSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('iframe[sandbox]')).toBeFalsy();
    expect(fixture.nativeElement.textContent).not.toContain('Confirm and enqueue');
  });

  it('reuses the same idempotency key only when the user resolves an uncertain submission', () => {
    create('lead');
    clickButton('Send email');
    flushOptions();
    createPreview('lead');
    const checkbox = fixture.nativeElement.querySelector(
      '.send-confirmation input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();
    clickButton('Confirm and enqueue');

    const first = http.expectOne(`${API_CONFIG.baseUrl}/mail/messages/send`);
    const firstKey = first.request.body.idempotency_key;
    first.error(new ProgressEvent('network error'), { status: 0, statusText: 'Unknown Error' });
    fixture.detectChanges();
    expect(http.match(`${API_CONFIG.baseUrl}/mail/messages/send`)).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('outcome is uncertain');

    clickButton('Resolve submission');
    const resolution = http.expectOne(`${API_CONFIG.baseUrl}/mail/messages/send`);
    expect(resolution.request.body.idempotency_key).toBe(firstKey);
    expect(resolution.request.body.preview_id).toBe('preview-1');
    resolution.flush({ success: true, data: message() });
  });

  it('hides the action without mail.send and blocks locally ineligible records', () => {
    permissions.delete(PERMISSIONS.mailSend);
    create('lead');
    expect(fixture.nativeElement.textContent).not.toContain('Send email');
    fixture.destroy();

    permissions.add(PERMISSIONS.mailSend);
    fixture = TestBed.createComponent(SendEmailComponent);
    fixture.componentRef.setInput('contextType', 'customer');
    fixture.componentRef.setInput('contextId', 'customer-1');
    fixture.componentRef.setInput('recipient', 'customer@example.com');
    fixture.componentRef.setInput('eligibilityIssues', [
      'Customer email consent is explicitly denied.',
    ]);
    fixture.detectChanges();
    clickButton('Send email');
    flushOptions();
    const previewButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button: unknown) => (button as HTMLButtonElement).textContent?.includes('Preview email'),
    ) as HTMLButtonElement;
    expect(previewButton.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(
      'Customer email consent is explicitly denied.',
    );
  });
});
