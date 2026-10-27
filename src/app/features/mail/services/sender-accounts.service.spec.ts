import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { SenderAccountCreateRequest } from '../models/sender-account.models';
import { SenderAccountsService } from './sender-accounts.service';

describe('SenderAccountsService', () => {
  let service: SenderAccountsService;
  let http: HttpTestingController;
  const baseUrl = `${API_CONFIG.baseUrl}/mail/sender-accounts`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SenderAccountsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uses the configured API URL and sender-account list query', () => {
    service.list(2, 20, true).subscribe();
    const request = http.expectOne(`${baseUrl}?page=2&size=20&include_inactive=true`);
    expect(request.request.method).toBe('GET');
    request.flush({ success: true, data: { items: [], page: 2, size: 20, total: 0 } });
  });

  it('creates an account without changing the credential payload', () => {
    const payload: SenderAccountCreateRequest = {
      display_name: 'Sales',
      sender_email: 'sales@example.com',
      provider: 'custom_smtp',
      authentication_type: 'password',
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      encryption: 'STARTTLS',
      smtp_username: 'sales@example.com',
      credential: 'secret-value',
      reply_to: null,
      is_active: true,
      is_default: false,
    };
    service.create(payload).subscribe();
    const request = http.expectOne(baseUrl);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);
    request.flush({ success: true, data: {} });
  });

  it('keeps connection testing and test-email delivery as separate endpoints', () => {
    service.testConnection('sender-id').subscribe();
    const connection = http.expectOne(`${baseUrl}/sender-id/test-connection`);
    expect(connection.request.method).toBe('POST');
    expect(connection.request.body).toEqual({});
    connection.flush({
      success: true,
      message: 'SMTP authentication successful; no email was sent',
      data: {
        sender_account_id: 'sender-id',
        connection_status: 'success',
        last_tested_at: '2026-10-11T00:00:00Z',
      },
    });

    service.sendTestEmail('sender-id', 'recipient@example.com').subscribe();
    const email = http.expectOne(`${baseUrl}/sender-id/test-email`);
    expect(email.request.method).toBe('POST');
    expect(email.request.body).toEqual({ recipient: 'recipient@example.com' });
    email.flush({ success: true, message: 'Test email sent' });
  });
});
