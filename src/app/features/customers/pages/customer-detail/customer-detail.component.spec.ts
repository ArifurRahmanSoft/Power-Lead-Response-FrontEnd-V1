import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { API_CONFIG } from '../../../../core/config/api.config';
import { AuthUser, PERMISSIONS, PermissionKey } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { CustomerDetail } from '../../models/customer.models';
import { OutboundMessage } from '../../../mail/models/outbound-message.models';
import { CustomerDetailComponent } from './customer-detail.component';

interface ExposedCustomerDetail {
  customer: WritableSignal<CustomerDetail | null>;
  emailEligibilityIssues(): readonly string[];
  statusLabel(status: string): string;
  failureReason(message: OutboundMessage): string;
}

const customerId = 'be2bd7db-b307-49de-8f9d-433be8ac9768';
const currentUser: AuthUser = {
  id: 'user-1',
  login_id: 'owner',
  name: 'Workspace Owner',
  email: 'owner@example.com',
};
const customer = {
  id: customerId,
  first_name: 'Empty',
  last_name: 'History',
  email: 'empty@example.com',
  phone: null,
  company: 'Example Co',
  communication_purpose: 'customer_relationship',
  communication_consent_status: 'unknown',
  channel_restrictions: [],
  suppressed_at: null,
  suppression_reason: null,
  created_at: '2026-10-15T04:00:00Z',
  row_version: 1,
  conversions: [],
};

describe('CustomerDetailComponent email activity', () => {
  let fixture: ComponentFixture<CustomerDetailComponent>;
  let component: ExposedCustomerDetail;
  let http: HttpTestingController;
  let permissions: Set<PermissionKey>;

  beforeEach(() => {
    permissions = new Set([PERMISSIONS.customersView, PERMISSIONS.mailView]);
    TestBed.configureTestingModule({
      imports: [CustomerDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ id: customerId }) },
          },
        },
        {
          provide: AuthService,
          useValue: {
            user: signal<AuthUser | null>(currentUser),
            hasPermission: (permission: PermissionKey) => permissions.has(permission),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CustomerDetailComponent);
    component = fixture.componentInstance as unknown as ExposedCustomerDetail;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  function flushCustomer(): void {
    http
      .expectOne(`${API_CONFIG.baseUrl}/customers/${customerId}`)
      .flush({ success: true, data: customer });
    fixture.detectChanges();
  }

  function expectHistoryRequest() {
    return http.expectOne(
      `${API_CONFIG.baseUrl}/mail/messages?page=1&size=100&customer_id=${customerId}`,
    );
  }

  it('treats an authorized empty history page as a normal empty state', () => {
    flushCustomer();
    const history = expectHistoryRequest();
    expect(history.request.method).toBe('GET');
    history.flush({ success: true, data: { items: [], page: 1, size: 100, total: 0 } });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No system email activity yet');
    expect(fixture.nativeElement.textContent).not.toContain('Unable to reach');
  });

  it('blocks only explicit customer consent denial while preserving suppression restrictions', () => {
    flushCustomer();
    expectHistoryRequest().flush({
      success: true,
      data: { items: [], page: 1, size: 100, total: 0 },
    });

    expect(component.emailEligibilityIssues()).toEqual([]);
    component.customer.set({ ...customer, communication_consent_status: '' });
    expect(component.emailEligibilityIssues()).toEqual([]);

    component.customer.set({ ...customer, communication_consent_status: 'denied' });
    expect(component.emailEligibilityIssues()).toEqual([
      'Customer email consent is explicitly denied.',
    ]);

    component.customer.set({
      ...customer,
      communication_consent_status: 'unknown',
      suppressed_at: '2026-10-16T04:00:00Z',
      suppression_reason: 'Manual opt-out',
    });
    expect(component.emailEligibilityIssues()).toEqual([
      'Customer email communication is suppressed.',
    ]);
  });

  it('preserves customer details and retries only history after a server failure', () => {
    flushCustomer();
    expectHistoryRequest().flush(
      { message: 'An unexpected error occurred' },
      { status: 500, statusText: 'Server Error' },
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Empty History');
    expect(fixture.nativeElement.textContent).toContain('empty@example.com');
    expect(fixture.nativeElement.textContent).toContain('returned a server error');

    const retry = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button: unknown) =>
        (button as HTMLButtonElement).textContent?.includes('Retry email history'),
    ) as HTMLButtonElement;
    retry.click();
    fixture.detectChanges();

    expectHistoryRequest().flush({
      success: true,
      data: { items: [], page: 1, size: 100, total: 0 },
    });
    fixture.detectChanges();
    http.expectNone(`${API_CONFIG.baseUrl}/customers/${customerId}`);
    expect(fixture.nativeElement.textContent).toContain('No system email activity yet');
  });

  it('uses backend history status and reason while preserving the mail type', () => {
    flushCustomer();
    const message = {
      id: 'message-1',
      job_id: 'job-1',
      context_type: 'customer',
      lead_id: null,
      customer_id: customerId,
      purpose: 'customer_service',
      contact_stage: 'final_follow_up',
      recipient_email: 'empty@example.com',
      sender: { display_name: 'Support', sender_email: 'support@example.com', reply_to: null },
      template_id: 'template-1',
      template_version: 2,
      subject: 'Follow-up',
      status: 'failed',
      created_at: '2026-10-15T04:00:00Z',
      processing_at: null,
      sent_at: null,
      failed_at: '2026-10-15T04:01:00Z',
      cancelled_at: null,
      failure_reason: 'Recipient mailbox is unavailable',
      events: [],
    } satisfies OutboundMessage;
    expectHistoryRequest().flush({
      success: true,
      data: { items: [message], page: 1, size: 100, total: 1 },
    });
    fixture.detectChanges();

    expect(component.statusLabel(message.status)).toBe('Failed');
    expect(component.failureReason(message)).toBe('Recipient mailbox is unavailable');
    expect(fixture.nativeElement.textContent).toContain('Mail type');
    expect(fixture.nativeElement.textContent).toContain('Final Follow Up');
    expect(fixture.nativeElement.textContent).toContain('Recipient mailbox is unavailable');
  });
});
