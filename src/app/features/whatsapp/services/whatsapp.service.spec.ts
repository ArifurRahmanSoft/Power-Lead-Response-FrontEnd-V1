import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { WhatsAppService } from './whatsapp.service';

describe('WhatsAppService', () => {
  let service: WhatsAppService;
  let http: HttpTestingController;
  const baseUrl = `${API_CONFIG.baseUrl}/messages/whatsapp`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WhatsAppService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uses server-backed conversation and history pagination', () => {
    service.listConversations(2, 20, ' +880 ').subscribe();
    const conversations = http.expectOne(
      (request) =>
        request.url === `${baseUrl}/conversations` &&
        request.params.get('page') === '2' &&
        request.params.get('size') === '20' &&
        request.params.get('search') === '+880',
    );
    expect(conversations.request.method).toBe('GET');
    conversations.flush({ success: true, message: '', data: {} });

    service.listMessages('conversation-1', 3, 50).subscribe();
    const messages = http.expectOne(
      `${baseUrl}/conversations/conversation-1/messages?page=3&size=50`,
    );
    expect(messages.request.method).toBe('GET');
    messages.flush({ success: true, message: '', data: {} });
  });

  it('sends the frozen idempotent request once and recovers with GET only', () => {
    const request = { body: 'বাংলা\nSecond line', idempotency_key: 'wa-fixed-key-0001' };
    service.reply('conversation-1', request).subscribe();
    const send = http.expectOne(`${baseUrl}/conversations/conversation-1/reply`);
    expect(send.request.method).toBe('POST');
    expect(send.request.body).toEqual(request);
    send.flush({ success: true, message: '', data: {} });

    service.recover(request.idempotency_key).subscribe();
    const recovery = http.expectOne(
      `${baseUrl}/operations/recover?idempotency_key=wa-fixed-key-0001`,
    );
    expect(recovery.request.method).toBe('GET');
    expect(http.match(`${baseUrl}/conversations/conversation-1/reply`)).toHaveLength(0);
    recovery.flush({ success: true, message: '', data: {} });
  });

  it('marks read and links with the contract methods', () => {
    service.markRead('conversation-1').subscribe();
    const read = http.expectOne(`${baseUrl}/conversations/conversation-1/read`);
    expect(read.request.method).toBe('POST');
    expect(read.request.body).toBeNull();
    read.flush({ success: true, message: '', data: {} });

    service.link('conversation-1', { customer_id: 'customer-1' }).subscribe();
    const link = http.expectOne(`${baseUrl}/conversations/conversation-1/link`);
    expect(link.request.method).toBe('PUT');
    expect(link.request.body).toEqual({ customer_id: 'customer-1' });
    link.flush({ success: true, message: '', data: {} });
  });
});
