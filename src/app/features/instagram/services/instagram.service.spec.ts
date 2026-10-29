import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { InstagramService, instagramApiRoot } from './instagram.service';

describe('InstagramService', () => {
  let service: InstagramService;
  let http: HttpTestingController;
  const baseUrl = `${API_CONFIG.baseUrl}/messages/meta/instagram`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(InstagramService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('builds only the authenticated Instagram API root', () => {
    expect(instagramApiRoot('https://api.example.test/api/')).toBe(
      'https://api.example.test/api/messages/meta/instagram',
    );
    expect(instagramApiRoot(API_CONFIG.baseUrl)).toBe(baseUrl);
    expect(() => instagramApiRoot('https://api.example.test/api/webhooks/meta/instagram')).toThrow(
      'A provider webhook URL cannot be used as the frontend API base.',
    );
  });

  it('uses the finalized conversation, search and history routes', () => {
    service.getChannel().subscribe();
    expect(http.expectOne(`${baseUrl}/channel`).request.method).toBe('GET');

    service.listConversations(2, 20, 'রহিম').subscribe();
    expect(
      http.expectOne(`${baseUrl}/conversations?page=2&size=20&search=${encodeURIComponent('রহিম')}`)
        .request.method,
    ).toBe('GET');

    service.listMessages('conversation-1', 3, 50).subscribe();
    expect(
      http.expectOne(`${baseUrl}/conversations/conversation-1/messages?page=3&size=50`).request
        .method,
    ).toBe('GET');
  });

  it('uses POST reply, GET-only recovery, CRM read and authorized linking', () => {
    const request = { text: 'ধন্যবাদ\nThank you', idempotency_key: 'instagram-fixed-001' };
    service.reply('conversation-1', request).subscribe();
    const reply = http.expectOne(`${baseUrl}/conversations/conversation-1/reply`);
    expect(reply.request.method).toBe('POST');
    expect(reply.request.body).toEqual(request);

    service.recover(request.idempotency_key).subscribe();
    expect(
      http.expectOne(`${baseUrl}/operations/recover?idempotency_key=instagram-fixed-001`).request
        .method,
    ).toBe('GET');

    service.markRead('conversation-1').subscribe();
    const read = http.expectOne(`${baseUrl}/conversations/conversation-1/read`);
    expect(read.request.method).toBe('POST');
    expect(read.request.body).toBeNull();

    service.link('conversation-1', { customer_id: 'customer-1' }).subscribe();
    const link = http.expectOne(`${baseUrl}/conversations/conversation-1/link`);
    expect(link.request.method).toBe('PUT');
    expect(link.request.body).toEqual({ customer_id: 'customer-1' });
  });
});
