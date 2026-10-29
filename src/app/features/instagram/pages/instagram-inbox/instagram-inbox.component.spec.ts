import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../../core/config/api.config';
import { PERMISSIONS } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { InstagramConversation, InstagramMessage } from '../../models/instagram.models';
import { InstagramInboxComponent } from './instagram-inbox.component';

describe('InstagramInboxComponent', () => {
  let fixture: ComponentFixture<InstagramInboxComponent>;
  let http: HttpTestingController;
  let canSend = true;
  const baseUrl = `${API_CONFIG.baseUrl}/messages/meta/instagram`;
  const auth = {
    hasPermission: (permission: string) =>
      permission === PERMISSIONS.messagesView ||
      (permission === PERMISSIONS.messagesSend && canSend),
    isAuthenticated: () => true,
    user: () => ({ id: 'user-1', name: 'Nadia Staff' }),
  };

  beforeEach(async () => {
    canSend = true;
    await TestBed.configureTestingModule({
      imports: [InstagramInboxComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(InstagramInboxComponent);
    fixture.detectChanges();
    http.expectOne(`${baseUrl}/channel`).flush({
      success: true,
      message: '',
      data: {
        id: 'channel-1',
        provider: 'instagram',
        account_id: 'provider-account-secret',
        account_display_name: 'PowerLead Instagram',
        configuration_id: 'configuration-secret',
        ready: true,
        active: true,
      },
    });
  });

  afterEach(() => {
    if (!fixture.componentRef.hostView.destroyed) fixture.destroy();
    http.verify();
  });

  it('loads conversations, search and paged history without exposing provider identifiers', () => {
    const first = conversation('conversation-1', 'Amina');
    flushConversationList([first], 2);
    flushHistory(first, [message('message-2', 'outbound', 'accepted', 'Thanks')], 2);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Amina');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'provider-account-secret',
    );

    (fixture.componentInstance as any).loadOlderMessages();
    const older = http.expectOne(`${baseUrl}/conversations/conversation-1/messages?page=2&size=50`);
    older.flush(
      historyResponse(first, [message('message-1', 'inbound', 'received', 'Hello')], 2, 2),
    );

    (fixture.componentInstance as any).searchConversations('রহিম');
    http
      .expectOne(`${baseUrl}/conversations?page=1&size=20&search=${encodeURIComponent('রহিম')}`)
      .flush(conversationResponse([], 1));
  });

  it('marks unread state through the CRM endpoint and never requests a provider receipt', () => {
    const unread = { ...conversation('conversation-1', 'Amina'), unread_count: 2 };
    flushConversationList([unread]);
    const read = http.expectOne(`${baseUrl}/conversations/conversation-1/read`);
    expect(read.request.method).toBe('POST');
    expect(read.request.body).toBeNull();
    read.flush({
      success: true,
      message: '',
      data: {
        conversation_id: unread.id,
        unread_count: 0,
        last_read_at: '2026-10-29T10:01:00Z',
        provider_receipt_sent: false,
      },
    });
    flushHistory(unread, []);
    expect(http.match((request) => request.url.includes('receipt'))).toHaveLength(0);
  });

  it('enforces send permission and backend reply eligibility', () => {
    canSend = false;
    const blocked = {
      ...conversation('conversation-1', 'Amina'),
      eligibility: {
        reply_allowed: false,
        window_expires_at: '2026-10-28T00:00:00Z',
        blocking_reasons: [
          { code: 'instagram_reply_window_closed', message: 'Instagram reply window closed' },
        ],
      },
    };
    flushConversationList([blocked]);
    flushHistory(blocked, []);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('do not have permission');
    expect(root.textContent).toContain('Instagram reply window closed');
    expect((root.querySelector('.send-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps reading and linking available when the backend reports send setup incomplete', () => {
    const first = conversation('conversation-1', 'Amina');
    flushConversationList([first]);
    flushHistory(first, []);
    (fixture.componentInstance as any).channel.update((value: object) => ({
      ...value,
      ready: false,
    }));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Ask a workspace administrator');
    expect((root.querySelector('.send-button') as HTMLButtonElement).disabled).toBe(true);
    expect(root.textContent).toContain('Link record');
  });

  it('preserves Unicode drafts and prevents duplicate-click submissions', () => {
    const first = conversation('conversation-1', 'Amina');
    flushConversationList([first]);
    flushHistory(first, []);
    fixture.detectChanges();
    enterDraft('ধন্যবাদ\nWe received your message.');

    const send = (fixture.nativeElement as HTMLElement).querySelector(
      '.send-button',
    ) as HTMLButtonElement;
    send.click();
    send.click();
    const requests = http.match(`${baseUrl}/conversations/conversation-1/reply`);
    expect(requests).toHaveLength(1);
    expect(requests[0].request.body.text).toBe('ধন্যবাদ\nWe received your message.');
    expect(requests[0].request.body.idempotency_key).toMatch(/^instagram-/);
    requests[0].flush(
      replyResponse(message('reply-1', 'outbound', 'accepted', requests[0].request.body.text)),
    );
    http
      .expectOne(`${baseUrl}/conversations?page=1&size=20`)
      .flush(conversationResponse([first], 1));
  });

  it('uses GET-only recovery with the original key after an uncertain submission', () => {
    const first = conversation('conversation-1', 'Amina');
    flushConversationList([first]);
    flushHistory(first, []);
    fixture.detectChanges();
    enterDraft('Keep this draft');
    (
      (fixture.nativeElement as HTMLElement).querySelector('.send-button') as HTMLButtonElement
    ).click();
    const reply = http.expectOne(`${baseUrl}/conversations/conversation-1/reply`);
    const operationKey = reply.request.body.idempotency_key as string;
    reply.error(new ProgressEvent('network error'));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('outcome is unknown');
    expect((fixture.nativeElement as HTMLInputElement).querySelector('textarea')?.value).toBe(
      'Keep this draft',
    );
    (
      (fixture.nativeElement as HTMLElement).querySelector('.feedback button') as HTMLButtonElement
    ).click();
    const recovery = http.expectOne(
      `${baseUrl}/operations/recover?idempotency_key=${operationKey}`,
    );
    expect(recovery.request.method).toBe('GET');
    expect(http.match(`${baseUrl}/conversations/conversation-1/reply`)).toHaveLength(0);
    recovery.flush({
      success: true,
      message: '',
      data: {
        idempotency_key: operationKey,
        found: false,
        operation_state: 'missing',
        message: null,
      },
    });
  });

  it('handles definitive provider failures separately and keeps the draft', () => {
    const first = conversation('conversation-1', 'Amina');
    flushConversationList([first]);
    flushHistory(first, []);
    fixture.detectChanges();
    enterDraft('Please reply');
    (
      (fixture.nativeElement as HTMLElement).querySelector('.send-button') as HTMLButtonElement
    ).click();
    http
      .expectOne(`${baseUrl}/conversations/conversation-1/reply`)
      .flush(
        { detail: { code: '190', message: 'The Instagram access token is invalid or expired' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    flushRefreshHistory(first, []);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('invalid or expired');
    expect((fixture.nativeElement as HTMLElement).querySelector('.feedback button')).toBeNull();
    expect((fixture.nativeElement as HTMLInputElement).querySelector('textarea')?.value).toBe(
      'Please reply',
    );
  });

  it('uses the safe fallback name and never displays IGSID', () => {
    const fallback = {
      ...conversation('conversation-1', 'Instagram user'),
      igsid: '178900000000-secret',
      display_name_available: false,
      contact_display_name_source: 'fallback' as const,
    };
    flushConversationList([fallback]);
    flushHistory(fallback, []);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Instagram user');
    expect(text).not.toContain(fallback.igsid);
  });

  it('supports mobile back navigation and separate drafts per conversation', () => {
    const first = conversation('conversation-1', 'Amina');
    const second = conversation('conversation-2', 'রহিম');
    (fixture.componentInstance as any).isMobile.set(true);
    flushConversationList([first, second]);
    fixture.detectChanges();
    clickConversation('Amina');
    flushHistory(first, []);
    fixture.detectChanges();
    enterDraft('Draft A');
    (
      (fixture.nativeElement as HTMLElement).querySelector('.back-button') as HTMLButtonElement
    ).click();
    clickConversation('রহিম');
    flushHistory(second, []);
    fixture.detectChanges();
    enterDraft('Draft B');
    (
      (fixture.nativeElement as HTMLElement).querySelector('.back-button') as HTMLButtonElement
    ).click();
    clickConversation('Amina');
    flushHistory(first, []);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLInputElement).querySelector('textarea')?.value).toBe(
      'Draft A',
    );
  });

  it('cleans up bounded polling timers on destruction', () => {
    flushConversationList([]);
    const clear = vi.spyOn(globalThis, 'clearInterval');
    fixture.destroy();
    expect(clear).toHaveBeenCalledTimes(2);
    clear.mockRestore();
  });

  function flushConversationList(items: InstagramConversation[], pages = 1): void {
    http
      .expectOne(`${baseUrl}/conversations?page=1&size=20`)
      .flush(conversationResponse(items, pages));
  }

  function flushHistory(
    selected: InstagramConversation,
    items: InstagramMessage[],
    pages = 1,
  ): void {
    http
      .expectOne(`${baseUrl}/conversations/${selected.id}/messages?page=1&size=50`)
      .flush(historyResponse(selected, items, 1, pages));
  }

  function flushRefreshHistory(selected: InstagramConversation, items: InstagramMessage[]): void {
    http
      .expectOne(`${baseUrl}/conversations/${selected.id}/messages?page=1&size=50`)
      .flush(historyResponse(selected, items));
  }

  function enterDraft(value: string): void {
    const textarea = (fixture.nativeElement as HTMLElement).querySelector('textarea')!;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function clickConversation(name: string): void {
    const item = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.conversation-item',
      ),
    ).find((button) => button.textContent?.includes(name));
    expect(item).toBeDefined();
    item!.click();
  }
});

function conversation(id: string, name: string): InstagramConversation {
  return {
    id,
    igsid: `igsid-${id}`,
    contact_display_name: name,
    display_name_available: true,
    contact_display_name_source: 'provider_profile',
    account_display_name: 'PowerLead Instagram',
    lead_id: null,
    customer_id: null,
    linked_record: null,
    last_message_at: '2026-10-29T10:00:00Z',
    last_message_preview: 'Hello',
    last_inbound_at: '2026-10-29T10:00:00Z',
    unread_count: 0,
    eligibility: {
      reply_allowed: true,
      window_expires_at: '2026-10-30T10:00:00Z',
      blocking_reasons: [],
    },
  };
}

function message(
  id: string,
  direction: 'inbound' | 'outbound',
  status: InstagramMessage['status'],
  body: string,
): InstagramMessage {
  return {
    id,
    conversation_id: 'conversation-1',
    direction,
    provider: 'instagram',
    source: direction === 'inbound' ? 'contact' : 'crm',
    actor_type: direction === 'inbound' ? 'contact' : 'crm_user',
    actor_user_id: direction === 'outbound' ? 'user-1' : null,
    body,
    media: [],
    status,
    provider_message_id: null,
    provider_error_code: null,
    failure_reason: null,
    requested_by_user_id: direction === 'outbound' ? 'user-1' : null,
    occurred_at: '2026-10-29T10:00:00Z',
    completed_at: null,
  };
}

function conversationResponse(items: InstagramConversation[], pages: number) {
  return {
    success: true,
    message: '',
    data: { items, page: 1, size: 20, total: items.length, pages },
  };
}

function historyResponse(
  selected: InstagramConversation,
  items: InstagramMessage[],
  page = 1,
  pages = 1,
) {
  return {
    success: true,
    message: '',
    data: { conversation: selected, items, page, size: 50, total: items.length, pages },
  };
}

function replyResponse(item: InstagramMessage) {
  return {
    success: true,
    message: '',
    data: { message: item, replayed: false, operation_state: 'completed' },
  };
}
