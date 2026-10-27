import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { SmsSendRequest } from '../models/sms.models';
import { SmsService } from './sms.service';

describe('SmsService', () => {
  let service: SmsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SmsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uses the documented SMS send contract', () => {
    const request: SmsSendRequest = {
      lead_ids: ['lead-1', 'lead-2'],
      message_template_id: 'template-1',
      contact_type: 'follow_up',
      idempotency_key: 'sms-key-0001',
    };

    service.send(request).subscribe();

    const pending = http.expectOne(`${API_CONFIG.baseUrl}/sms/send`);
    expect(pending.request.method).toBe('POST');
    expect(pending.request.body).toEqual(request);
    pending.flush({ success: true, message: 'SMS send completed', data: {} });
  });

  it('recovers an operation with a read-only request and the original idempotency key', () => {
    service.recover('sms-key-0001').subscribe();

    const recovery = http.expectOne(
      (request) =>
        request.url === `${API_CONFIG.baseUrl}/sms/operations/recover` &&
        request.params.get('idempotency_key') === 'sms-key-0001',
    );
    expect(recovery.request.method).toBe('GET');
    expect(recovery.request.body).toBeNull();
    recovery.flush({
      success: true,
      message: 'No SMS operation exists for this idempotency key',
      data: {
        idempotency_key: 'sms-key-0001',
        found: false,
        operation_state: 'missing',
        batch: null,
      },
    });
  });

  it('reads batches and refreshes a message without a payload', () => {
    service.getBatch('batch-1').subscribe();
    const batch = http.expectOne(`${API_CONFIG.baseUrl}/sms/batches/batch-1`);
    expect(batch.request.method).toBe('GET');
    batch.flush({ success: true, message: 'SMS batch status', data: {} });

    service.refreshStatus('message-1').subscribe();
    const refresh = http.expectOne(`${API_CONFIG.baseUrl}/sms/messages/message-1/refresh-status`);
    expect(refresh.request.method).toBe('POST');
    expect(refresh.request.body).toBeNull();
    refresh.flush({ success: true, data: {} });
  });
});
