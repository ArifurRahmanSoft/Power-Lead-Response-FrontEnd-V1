import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { MetaWhatsAppService, metaWhatsAppApiRoot } from './meta-whatsapp.service';

describe('MetaWhatsAppService', () => {
  let service: MetaWhatsAppService;
  let http: HttpTestingController;
  const baseUrl = `${API_CONFIG.baseUrl}/messages/meta/whatsapp`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MetaWhatsAppService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('builds the Meta API root from the central API base without duplicate api segments', () => {
    expect(metaWhatsAppApiRoot('https://api.example.test/api/')).toBe(
      'https://api.example.test/api/messages/meta/whatsapp',
    );
    expect(metaWhatsAppApiRoot(API_CONFIG.baseUrl)).toBe(baseUrl);
    expect(baseUrl).not.toContain('/webhooks/');
    expect(new URL(baseUrl).pathname.match(/\/api(?:\/|$)/g)).toHaveLength(1);
  });

  it('rejects a provider webhook URL as a frontend API base', () => {
    expect(() =>
      metaWhatsAppApiRoot('https://api.example.test/api/webhooks/meta/whatsapp'),
    ).toThrowError('A provider webhook URL cannot be used as the frontend API base.');
  });

  it('uses the finalized channel, conversation, history and template routes', () => {
    service.getChannel().subscribe();
    expect(http.expectOne(`${baseUrl}/channel`).request.method).toBe('GET');

    service.listConversations(2, 20, '+1415').subscribe();
    const conversations = http.expectOne(`${baseUrl}/conversations?page=2&size=20&search=%2B1415`);
    expect(conversations.request.method).toBe('GET');

    service.listMessages('conversation-1', 3, 50).subscribe();
    expect(
      http.expectOne(`${baseUrl}/conversations/conversation-1/messages?page=3&size=50`).request
        .method,
    ).toBe('GET');

    service.listTemplates(1, 100).subscribe();
    expect(http.expectOne(`${baseUrl}/templates?page=1&size=100`).request.method).toBe('GET');
  });

  it('opens without sending and uses explicit send and GET-only recovery', () => {
    service.openConversation({ phone_number: '+14155552671' }).subscribe();
    const open = http.expectOne(`${baseUrl}/conversations/open`);
    expect(open.request.method).toBe('POST');
    expect(open.request.body).toEqual({ phone_number: '+14155552671' });
    expect(http.match(`${baseUrl}/send`)).toHaveLength(0);

    const request = {
      conversation_id: 'conversation-1',
      mode: 'text' as const,
      text: 'Hello',
      purpose: 'lead_acquisition' as const,
      idempotency_key: 'meta-wa-fixed-001',
    };
    service.send(request).subscribe();
    const send = http.expectOne(`${baseUrl}/send`);
    expect(send.request.method).toBe('POST');
    expect(send.request.body).toEqual(request);

    service.recover(request.idempotency_key).subscribe();
    const recovery = http.expectOne(
      `${baseUrl}/operations/recover?idempotency_key=meta-wa-fixed-001`,
    );
    expect(recovery.request.method).toBe('GET');
    expect(http.match(`${baseUrl}/send`)).toHaveLength(0);
  });

  it('marks read and links through Meta-specific routes', () => {
    service.markRead('conversation-1').subscribe();
    const read = http.expectOne(`${baseUrl}/conversations/conversation-1/read`);
    expect(read.request.method).toBe('POST');
    expect(read.request.body).toBeNull();

    service.link('conversation-1', { lead_id: 'lead-1' }).subscribe();
    const link = http.expectOne(`${baseUrl}/conversations/conversation-1/link`);
    expect(link.request.method).toBe('PUT');
    expect(link.request.body).toEqual({ lead_id: 'lead-1' });
  });

  it('uses the same API root for every Meta operation', () => {
    service.getChannel().subscribe();
    service.listConversations(1, 20).subscribe();
    service.openConversation({ phone_number: '+14155552671' }).subscribe();
    service.listMessages('conversation-1', 1, 50).subscribe();
    service.listTemplates(1, 20).subscribe();
    service
      .send({
        conversation_id: 'conversation-1',
        mode: 'text',
        text: 'Hello',
        purpose: 'lead_acquisition',
        idempotency_key: 'meta-wa-route-001',
      })
      .subscribe();
    service.recover('meta-wa-route-001').subscribe();
    service.markRead('conversation-1').subscribe();
    service.link('conversation-1', { customer_id: 'customer-1' }).subscribe();

    const requests = http.match(() => true);
    expect(requests.map((request) => request.request.urlWithParams)).toEqual([
      `${baseUrl}/channel`,
      `${baseUrl}/conversations?page=1&size=20`,
      `${baseUrl}/conversations/open`,
      `${baseUrl}/conversations/conversation-1/messages?page=1&size=50`,
      `${baseUrl}/templates?page=1&size=20`,
      `${baseUrl}/send`,
      `${baseUrl}/operations/recover?idempotency_key=meta-wa-route-001`,
      `${baseUrl}/conversations/conversation-1/read`,
      `${baseUrl}/conversations/conversation-1/link`,
    ]);
    expect(requests.every((request) => !request.request.url.includes('/webhooks/'))).toBe(true);
  });
});
