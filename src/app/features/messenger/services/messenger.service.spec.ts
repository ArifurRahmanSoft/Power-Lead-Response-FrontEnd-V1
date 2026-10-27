import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { MessengerService, messengerApiRoot } from './messenger.service';

describe('MessengerService', () => {
  let service: MessengerService;
  let http: HttpTestingController;
  const baseUrl = `${API_CONFIG.baseUrl}/messages/meta/messenger`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MessengerService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('builds the authenticated API root without duplicate api segments or webhook routes', () => {
    expect(messengerApiRoot('https://api.example.test/api/')).toBe(
      'https://api.example.test/api/messages/meta/messenger',
    );
    expect(messengerApiRoot(API_CONFIG.baseUrl)).toBe(baseUrl);
    expect(new URL(baseUrl).pathname.match(/\/api(?:\/|$)/g)).toHaveLength(1);
    expect(baseUrl).not.toContain('/webhooks/');
  });

  it('rejects a provider webhook URL as a frontend API base', () => {
    expect(() => messengerApiRoot('https://api.example.test/api/webhooks/meta/messenger')).toThrow(
      'A provider webhook URL cannot be used as the frontend API base.',
    );
  });

  it('uses the finalized channel, conversation and history routes', () => {
    service.getChannel().subscribe();
    expect(http.expectOne(`${baseUrl}/channel`).request.method).toBe('GET');

    service.listConversations(2, 20, 'Amina').subscribe();
    expect(
      http.expectOne(`${baseUrl}/conversations?page=2&size=20&search=Amina`).request.method,
    ).toBe('GET');

    service.listMessages('conversation-1', 3, 50).subscribe();
    expect(
      http.expectOne(`${baseUrl}/conversations/conversation-1/messages?page=3&size=50`).request
        .method,
    ).toBe('GET');

    service
      .refreshProfiles({ conversation_ids: ['conversation-1'], refresh_page: true })
      .subscribe();
    const refresh = http.expectOne(`${baseUrl}/profiles/refresh`);
    expect(refresh.request.method).toBe('POST');
    expect(refresh.request.body).toEqual({
      conversation_ids: ['conversation-1'],
      refresh_page: true,
    });
  });

  it('uses explicit reply, GET-only recovery, read and link contracts', () => {
    const request = { text: 'Hello', idempotency_key: 'messenger-fixed-001' };
    service.reply('conversation-1', request).subscribe();
    const reply = http.expectOne(`${baseUrl}/conversations/conversation-1/reply`);
    expect(reply.request.method).toBe('POST');
    expect(reply.request.body).toEqual(request);

    service.recover(request.idempotency_key).subscribe();
    const recovery = http.expectOne(
      `${baseUrl}/operations/recover?idempotency_key=messenger-fixed-001`,
    );
    expect(recovery.request.method).toBe('GET');

    service.markRead('conversation-1').subscribe();
    const read = http.expectOne(`${baseUrl}/conversations/conversation-1/read`);
    expect(read.request.method).toBe('POST');
    expect(read.request.body).toBeNull();

    service.link('conversation-1', { lead_id: 'lead-1' }).subscribe();
    const link = http.expectOne(`${baseUrl}/conversations/conversation-1/link`);
    expect(link.request.method).toBe('PUT');
    expect(link.request.body).toEqual({ lead_id: 'lead-1' });

    expect(http.match(`${baseUrl}/conversations/conversation-1/reply`)).toHaveLength(0);
  });
});
