import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { OutboundMessagesService } from './outbound-messages.service';

describe('OutboundMessagesService', () => {
  let service: OutboundMessagesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OutboundMessagesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uses the preview and send contract without accepting a recipient override', () => {
    service
      .preview({
        context_type: 'lead',
        context_id: 'lead-1',
        sender_account_id: 'sender-1',
        template_id: 'template-1',
        template_version: 3,
        purpose: 'lead_acquisition',
      })
      .subscribe();
    const preview = http.expectOne(`${API_CONFIG.baseUrl}/mail/messages/preview`);
    expect(preview.request.method).toBe('POST');
    expect(preview.request.body.recipient).toBeUndefined();
    preview.flush({ success: true, data: {} });

    service
      .send({
        preview_id: 'preview-1',
        preview_hash: 'a'.repeat(64),
        idempotency_key: 'mail-key-1',
      })
      .subscribe();
    const send = http.expectOne(`${API_CONFIG.baseUrl}/mail/messages/send`);
    expect(send.request.method).toBe('POST');
    expect(send.request.body).toEqual({
      preview_id: 'preview-1',
      preview_hash: 'a'.repeat(64),
      idempotency_key: 'mail-key-1',
    });
    send.flush({ success: true, data: {} });
  });

  it('lists by authorized context and posts cancellation reasons', () => {
    service.list(1, 100, { customerId: 'customer-1', status: 'queued' }).subscribe();
    const list = http.expectOne(
      `${API_CONFIG.baseUrl}/mail/messages?page=1&size=100&customer_id=customer-1&status=queued`,
    );
    expect(list.request.method).toBe('GET');
    list.flush({ success: true, data: { items: [], page: 1, size: 100, total: 0 } });

    service.cancel('message-1', 'User cancelled').subscribe();
    const cancel = http.expectOne(`${API_CONFIG.baseUrl}/mail/messages/message-1/cancel`);
    expect(cancel.request.method).toBe('POST');
    expect(cancel.request.body).toEqual({ reason: 'User cancelled' });
    cancel.flush({ success: true, data: {} });
  });

  it('rejects a malformed history envelope instead of treating it as empty history', () => {
    const error = vi.fn();
    service.list(1, 100, { customerId: 'customer-1' }).subscribe({ error });

    http
      .expectOne(`${API_CONFIG.baseUrl}/mail/messages?page=1&size=100&customer_id=customer-1`)
      .flush({ success: true, items: [] });

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'OutboundMessageContractError' }),
    );
  });

  it('uses the backend bulk preview contract for selected and all-matching scopes', () => {
    service
      .previewBatch({
        selection_mode: 'selected',
        lead_ids: ['lead-1', 'lead-2'],
        sender_account_id: 'sender-1',
        template_id: 'template-1',
        template_version: 2,
        contact_stage: 'follow_up',
        page: 1,
        size: 20,
      })
      .subscribe();
    const selected = http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/preview`);
    expect(selected.request.body).toEqual(
      expect.objectContaining({
        selection_mode: 'selected',
        lead_ids: ['lead-1', 'lead-2'],
        contact_stage: 'follow_up',
      }),
    );
    expect(selected.request.body.filters).toBeUndefined();
    selected.flush({ success: true, data: {} });

    service
      .previewBatch({
        selection_mode: 'all_matching',
        filters: { status: 'qualified', country: 'Bangladesh' },
        sender_account_id: 'sender-1',
        template_id: 'template-1',
        template_version: 2,
        contact_stage: 'initial',
        page: 1,
        size: 20,
      })
      .subscribe();
    const matching = http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/preview`);
    expect(matching.request.body.filters).toEqual({ status: 'qualified', country: 'Bangladesh' });
    expect(matching.request.body.lead_ids).toBeUndefined();
    matching.flush({ success: true, data: {} });
  });

  it('posts the direct batch send contract without a preview token', () => {
    service
      .sendBatchDirect({
        selection_mode: 'selected',
        lead_ids: ['lead-1'],
        sender_account_id: 'sender-1',
        template_id: 'template-1',
        template_version: 2,
        contact_type: 'final_follow_up',
        supersede_queued: false,
        idempotency_key: 'direct-key-1',
      })
      .subscribe();

    const send = http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/send`);
    expect(send.request.method).toBe('POST');
    expect(send.request.body).toEqual({
      selection_mode: 'selected',
      lead_ids: ['lead-1'],
      sender_account_id: 'sender-1',
      template_id: 'template-1',
      template_version: 2,
      contact_type: 'final_follow_up',
      supersede_queued: false,
      idempotency_key: 'direct-key-1',
    });
    expect(send.request.body.preview_hash).toBeUndefined();
    send.flush({ success: true, message: 'Direct email processing completed', data: {} });
  });

  it('confirms, refreshes, pages and cancels batches at the documented endpoints', () => {
    service
      .confirmBatch('batch-1', {
        preview_hash: 'b'.repeat(64),
        idempotency_key: 'bulk-key-1',
      })
      .subscribe();
    const confirm = http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1/confirm`);
    expect(confirm.request.method).toBe('POST');
    expect(confirm.request.body.idempotency_key).toBe('bulk-key-1');
    confirm.flush({ success: true, data: {} });

    service.getBatch('batch-1').subscribe();
    http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1`).flush({ success: true, data: {} });

    service.getBatchRecipients('batch-1', 2, 20).subscribe();
    http
      .expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1/recipients?page=2&size=20`)
      .flush({ success: true, data: {} });

    service.cancelBatch('batch-1', 'Stop remaining').subscribe();
    const cancel = http.expectOne(`${API_CONFIG.baseUrl}/mail/batches/batch-1/cancel`);
    expect(cancel.request.body).toEqual({ reason: 'Stop remaining' });
    cancel.flush({ success: true, data: { cancelled: 1, in_flight: 0, already_terminal: 0 } });
  });
});
