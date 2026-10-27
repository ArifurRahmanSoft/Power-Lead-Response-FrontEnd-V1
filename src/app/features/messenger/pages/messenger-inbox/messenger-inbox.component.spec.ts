import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../../core/config/api.config';
import { PERMISSIONS } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { MessengerConversation, MessengerMessage } from '../../models/messenger.models';
import { MessengerInboxComponent } from './messenger-inbox.component';

describe('MessengerInboxComponent', () => {
  let fixture: ComponentFixture<MessengerInboxComponent>;
  let http: HttpTestingController;
  const baseUrl = `${API_CONFIG.baseUrl}/messages/meta/messenger`;
  const first = conversation('conversation-1', 'Amina Rahman');
  const second = conversation('conversation-2', 'রহিম');
  let canSend = true;
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
      imports: [MessengerInboxComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MessengerInboxComponent);
    fixture.detectChanges();
    http.expectOne(`${baseUrl}/channel`).flush({
      success: true,
      message: '',
      data: {
        id: 'messenger-channel-1',
        provider: 'messenger',
        page_id: 'page-provider-id',
        page_display_name: 'PowerLead Page',
        display_name_available: true,
        profile_refreshed_at: '2026-10-26T09:00:00Z',
        active: true,
      },
    });
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    vi.useRealTimers();
  });

  it('renders text safely, attachment placeholders, and distinct accepted/delivered statuses', () => {
    flushInitial(
      [first],
      [
        message('message-2', 'outbound', 'accepted', 'Thanks'),
        {
          ...message('message-1', 'inbound', 'received', '<strong>Hello</strong>'),
          media: [{ type: 'image', unsupported: true }],
        },
      ],
    );

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('<strong>Hello</strong>');
    expect(root.querySelector('.message-bubble strong')).toBeNull();
    expect(root.textContent).toContain('Unsupported Messenger image attachment');
    expect(root.textContent).toContain('Accepted');
    expect(root.textContent).toContain('Conversation via PowerLead Page');
    expect(root.textContent).toContain('PowerLead Page · Nadia Staff (you)');
    expect(root.textContent).not.toContain('page-provider-id');
  });

  it('keeps generic names when backend profile metadata is unavailable', () => {
    const fallback = {
      ...first,
      psid: 'psid-must-not-render',
      contact_display_name: 'Messenger user',
      display_name_available: false,
      contact_display_name_source: 'fallback' as const,
      page_display_name: 'Facebook Page',
    };
    setFallbackChannel();
    http
      .expectOne(`${baseUrl}/conversations?page=1&size=20`)
      .flush(conversationResponse([fallback]));
    fixture.detectChanges();
    const refresh = http.expectOne(`${baseUrl}/profiles/refresh`);
    expect(refresh.request.body).toEqual({
      conversation_ids: [fallback.id],
      refresh_page: true,
    });
    refresh.flush({
      success: true,
      message: '',
      data: {
        page_display_name: 'Facebook Page',
        page_status: 'unavailable',
        items: [
          {
            conversation_id: fallback.id,
            status: 'unavailable',
            contact_display_name: 'Messenger user',
            display_name_available: false,
            reason_code: 'profile_unavailable',
          },
        ],
        requested_count: 1,
        refreshed_count: 0,
        unavailable_count: 1,
      },
    });
    flushHistory(fallback, []);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Messenger user');
    expect(text).toContain('Conversation via Facebook Page');
    expect(text).not.toContain('psid-must-not-render');
    expect(text).not.toContain('page-provider-id');
  });

  it('applies delayed backend metadata to the list and header and resists a stale history response', () => {
    const fallback = {
      ...first,
      contact_display_name: 'Messenger user',
      display_name_available: false,
      contact_display_name_source: 'fallback' as const,
      page_display_name: 'Facebook Page',
    };
    setFallbackChannel();
    http
      .expectOne(`${baseUrl}/conversations?page=1&size=20`)
      .flush(conversationResponse([fallback]));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Messenger user');

    http.expectOne(`${baseUrl}/profiles/refresh`).flush({
      success: true,
      message: '',
      data: {
        page_display_name: 'PowerLead Support',
        page_status: 'refreshed',
        items: [
          {
            conversation_id: fallback.id,
            status: 'refreshed',
            contact_display_name: 'Arif Messenger',
            display_name_available: true,
            reason_code: null,
          },
        ],
        requested_count: 1,
        refreshed_count: 1,
        unavailable_count: 0,
      },
    });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Arif Messenger');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Conversation via PowerLead Support',
    );

    flushHistory(fallback, []);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Arif Messenger');
    expect(text).toContain('Conversation via PowerLead Support');
  });

  it('does not expose another CRM performer identity when no authorized name is returned', () => {
    const otherStaff = {
      ...message('other-staff-message', 'outbound', 'delivered', 'Handled by another teammate'),
      actor_user_id: 'other-user-id',
      requested_by_user_id: 'other-user-id',
    };
    flushInitial([first], [otherStaff]);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('PowerLead Page · CRM staff');
    expect(text).not.toContain('other-user-id');
    expect(text).not.toContain('Nadia Staff (you)');
  });

  it('supports server pagination and debounced search without replacing the selected chat', async () => {
    http.expectOne(`${baseUrl}/conversations?page=1&size=20`).flush({
      ...conversationResponse([first]),
      data: { items: [first], page: 1, size: 20, total: 2, pages: 2 },
    });
    fixture.detectChanges();
    flushHistory(first, []);
    fixture.detectChanges();

    findButton('Load more conversations').click();
    http.expectOne(`${baseUrl}/conversations?page=2&size=20`).flush({
      ...conversationResponse([second]),
      data: { items: [second], page: 2, size: 20, total: 2, pages: 2 },
    });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('রহিম');

    const search = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.search-box input',
    )!;
    search.value = 'Amina';
    search.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 375));
    const request = http.expectOne(`${baseUrl}/conversations?page=1&size=20&search=Amina`);
    expect(request.request.method).toBe('GET');
    request.flush(conversationResponse([first]));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Amina Rahman');
  });

  it('loads older history and keeps messages in chronological order', () => {
    http.expectOne(`${baseUrl}/conversations?page=1&size=20`).flush(conversationResponse([first]));
    fixture.detectChanges();
    http
      .expectOne(`${baseUrl}/conversations/${first.id}/messages?page=1&size=50`)
      .flush(messageResponse(first, [message('newer', 'inbound', 'received', 'Newer')], 1, 2));
    fixture.detectChanges();
    (fixture.componentInstance as unknown as { loadOlderMessages: () => void }).loadOlderMessages();
    http.expectOne(`${baseUrl}/conversations/${first.id}/messages?page=2&size=50`).flush(
      messageResponse(
        first,
        [
          {
            ...message('older', 'inbound', 'received', 'Older'),
            occurred_at: '2026-10-25T09:00:00Z',
          },
        ],
        2,
        2,
      ),
    );
    fixture.detectChanges();
    const bubbles = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.message-bubble'),
    );
    expect(bubbles.map((bubble) => bubble.textContent)).toEqual([
      expect.stringContaining('Older'),
      expect.stringContaining('Newer'),
    ]);
  });

  it('preserves Unicode drafts per Page and conversation while switching', () => {
    flushInitial([first, second], []);
    enterDraft('প্রথম খসড়া\nদ্বিতীয় লাইন');

    selectConversation('রহিম');
    flushHistory(second, []);
    enterDraft('Second contact');
    selectConversation('Amina');
    flushHistory(first, []);
    fixture.detectChanges();

    expect(textarea().value).toBe('প্রথম খসড়া\nদ্বিতীয় লাইন');
  });

  it('freezes one explicit reply and preserves edits typed while it is submitting', () => {
    flushInitial([first], []);
    enterDraft('Original reply');
    const sendButton = findButton('Send');
    sendButton.click();
    sendButton.click();

    const sends = http.match(`${baseUrl}/conversations/${first.id}/reply`);
    expect(sends).toHaveLength(1);
    expect(sends[0].request.body.text).toBe('Original reply');
    expect(sends[0].request.body.idempotency_key).toMatch(/^messenger-/);
    enterDraft('Edited while submitting');
    sends[0].flush({
      success: true,
      message: '',
      data: {
        message: message('outbound-1', 'outbound', 'accepted', 'Original reply'),
        replayed: false,
        operation_state: 'completed',
      },
    });
    http.expectOne(`${baseUrl}/conversations?page=1&size=20`).flush(conversationResponse([first]));
    fixture.detectChanges();
    expect(textarea().value).toBe('Edited while submitting');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Delivery and read status may update later',
    );
  });

  it('preserves the draft on structured definitive failure', () => {
    flushInitial([first], []);
    enterDraft('Do not discard');
    findButton('Send').click();
    http.expectOne(`${baseUrl}/conversations/${first.id}/reply`).flush(
      {
        detail: {
          code: 'messenger_reply_window_closed',
          message: 'The standard Messenger reply window is closed',
        },
      },
      { status: 409, statusText: 'Conflict' },
    );
    http
      .expectOne(`${baseUrl}/conversations/${first.id}/messages?page=1&size=50`)
      .flush(messageResponse(first, []));
    fixture.detectChanges();
    expect(textarea().value).toBe('Do not discard');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'The standard Messenger reply window is closed',
    );
  });

  it('uses GET-only recovery after an uncertain result and never resends', () => {
    flushInitial([first], []);
    enterDraft('Check the original operation');
    findButton('Send').click();
    const send = http.expectOne(`${baseUrl}/conversations/${first.id}/reply`);
    const key = send.request.body.idempotency_key as string;
    send.error(new ProgressEvent('network error'));
    fixture.detectChanges();

    findButton('Check Result').click();
    const recovery = http.expectOne(
      `${baseUrl}/operations/recover?idempotency_key=${encodeURIComponent(key)}`,
    );
    expect(recovery.request.method).toBe('GET');
    expect(http.match(`${baseUrl}/conversations/${first.id}/reply`)).toHaveLength(0);
    recovery.flush({
      success: true,
      message: '',
      data: {
        idempotency_key: key,
        found: true,
        operation_state: 'completed',
        message: message('recovered', 'outbound', 'accepted', 'Check the original operation'),
      },
    });
    http.expectOne(`${baseUrl}/conversations?page=1&size=20`).flush(conversationResponse([first]));
    fixture.detectChanges();
    expect(textarea().value).toBe('');
  });

  it('reconciles a later poll or echo update without duplicating or resending', () => {
    flushInitial([first], []);
    enterDraft('Await the echo');
    findButton('Send').click();
    const send = http.expectOne(`${baseUrl}/conversations/${first.id}/reply`);
    send.flush({
      success: true,
      message: '',
      data: {
        message: message('echo-message', 'outbound', 'unknown', 'Await the echo'),
        replayed: false,
        operation_state: 'completed',
      },
    });
    fixture.detectChanges();
    expect(findButton('Check Result')).toBeTruthy();

    (
      fixture.componentInstance as unknown as {
        loadMessages: (id: string, page: number, refresh: boolean) => void;
      }
    ).loadMessages(first.id, 1, true);
    http
      .expectOne(`${baseUrl}/conversations/${first.id}/messages?page=1&size=50`)
      .flush(
        messageResponse(first, [
          message('echo-message', 'outbound', 'delivered', 'Await the echo'),
        ]),
      );
    fixture.detectChanges();
    expect(textarea().value).toBe('');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'The original reply is now delivered',
    );
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.message-bubble')).toHaveLength(
      1,
    );
    expect(http.match(`${baseUrl}/conversations/${first.id}/reply`)).toHaveLength(0);
  });

  it('ignores a late history response from the previously selected conversation', () => {
    http
      .expectOne(`${baseUrl}/conversations?page=1&size=20`)
      .flush(conversationResponse([first, second]));
    fixture.detectChanges();
    const stale = http.expectOne(`${baseUrl}/conversations/${first.id}/messages?page=1&size=50`);
    selectConversation('রহিম');
    stale.flush(messageResponse(first, [message('stale', 'inbound', 'received', 'Stale Amina')]));
    const current = http.expectOne(`${baseUrl}/conversations/${second.id}/messages?page=1&size=50`);
    current.flush(
      messageResponse(second, [message('current', 'inbound', 'received', 'Current Rahim')]),
    );
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Current Rahim');
    expect(text).not.toContain('Stale Amina');
  });

  it('uses server eligibility to block replies with its actionable explanation', () => {
    const closed = {
      ...first,
      eligibility: {
        reply_allowed: false,
        window_expires_at: '2000-01-01T00:00:00Z',
        blocking_reasons: [
          {
            code: 'messenger_reply_window_closed',
            message: 'The standard Messenger reply window is closed',
          },
        ],
      },
    };
    flushInitial([closed], []);
    enterDraft('Cannot send this');
    expect(findButton('Send').disabled).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'The standard Messenger reply window is closed',
    );
    findButton('Send').click();
    expect(http.match(`${baseUrl}/conversations/${first.id}/reply`)).toHaveLength(0);
  });

  it('enforces messages.send for reply and linking actions', () => {
    canSend = false;
    flushInitial([first], []);
    fixture.detectChanges();
    enterDraft('Read only');
    expect(findButton('Send').disabled).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'you do not have permission to send Messenger replies',
    );
    expect(
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      ).some((button) => button.textContent?.includes('Link record')),
    ).toBe(false);
  });

  it('marks unread state only for the selected visible conversation', () => {
    const unread = { ...first, unread_count: 3 };
    http.expectOne(`${baseUrl}/conversations?page=1&size=20`).flush(conversationResponse([unread]));
    fixture.detectChanges();
    const read = http.expectOne(`${baseUrl}/conversations/${first.id}/read`);
    expect(read.request.method).toBe('POST');
    read.flush({
      success: true,
      message: '',
      data: { conversation_id: first.id, unread_count: 0, last_read_at: '2026-10-26T10:00:00Z' },
    });
    flushHistory(unread, []);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.unread-badge')).toBeNull();
  });

  it('cleans up polling and eligibility timers on destruction', () => {
    http.expectOne(`${baseUrl}/conversations?page=1&size=20`).flush(conversationResponse([]));
    fixture.detectChanges();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    fixture.destroy();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    clearIntervalSpy.mockRestore();
  });

  function flushInitial(
    conversations: MessengerConversation[],
    messages: MessengerMessage[],
  ): void {
    http
      .expectOne(`${baseUrl}/conversations?page=1&size=20`)
      .flush(conversationResponse(conversations));
    fixture.detectChanges();
    if (conversations[0]) flushHistory(conversations[0], messages);
    fixture.detectChanges();
  }

  function flushHistory(current: MessengerConversation, messages: MessengerMessage[]): void {
    http
      .expectOne(`${baseUrl}/conversations/${current.id}/messages?page=1&size=50`)
      .flush(messageResponse(current, messages));
  }

  function selectConversation(name: string): void {
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.conversation-item',
      ),
    ).find((item) => item.textContent?.includes(name));
    expect(button).toBeTruthy();
    button!.click();
    fixture.detectChanges();
  }

  function enterDraft(value: string): void {
    const field = textarea();
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function textarea(): HTMLTextAreaElement {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('textarea')!;
  }

  function findButton(label: string): HTMLButtonElement {
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((item) => item.textContent?.trim().includes(label));
    expect(button).toBeTruthy();
    return button!;
  }

  function setFallbackChannel(): void {
    const component = fixture.componentInstance as unknown as {
      channel: {
        (): {
          id: string;
          provider: 'messenger';
          page_id: string;
          page_display_name: string;
          display_name_available: boolean;
          profile_refreshed_at: string | null;
          active: boolean;
        };
        set: (value: {
          id: string;
          provider: 'messenger';
          page_id: string;
          page_display_name: string;
          display_name_available: boolean;
          profile_refreshed_at: string | null;
          active: boolean;
        }) => void;
      };
    };
    component.channel.set({
      ...component.channel(),
      page_display_name: 'Facebook Page',
      display_name_available: false,
      profile_refreshed_at: null,
    });
  }
});

function conversation(id: string, name: string): MessengerConversation {
  return {
    id,
    psid: `provider-${id}`,
    contact_display_name: name,
    display_name_available: true,
    contact_display_name_source: 'provider_profile',
    page_display_name: 'PowerLead Page',
    lead_id: null,
    customer_id: null,
    linked_record: null,
    last_message_at: id === 'conversation-1' ? '2026-10-26T11:00:00Z' : '2026-10-26T10:00:00Z',
    last_message_preview: 'Hello',
    last_inbound_at: '2026-10-26T10:00:00Z',
    unread_count: 0,
    eligibility: {
      reply_allowed: true,
      window_expires_at: '2099-10-27T10:00:00Z',
      blocking_reasons: [],
    },
  };
}

function message(
  id: string,
  direction: 'inbound' | 'outbound',
  status: string,
  body: string,
): MessengerMessage {
  return {
    id,
    conversation_id: 'conversation-1',
    direction,
    provider: 'messenger',
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
    occurred_at: '2026-10-26T10:00:00Z',
    completed_at: '2026-10-26T10:00:01Z',
  };
}

function conversationResponse(items: MessengerConversation[]) {
  return {
    success: true,
    message: '',
    data: { items, page: 1, size: 20, total: items.length, pages: items.length ? 1 : 0 },
  };
}

function messageResponse(
  current: MessengerConversation,
  items: MessengerMessage[],
  page = 1,
  pages = 1,
) {
  return {
    success: true,
    message: '',
    data: { conversation: current, items, page, size: 50, total: items.length, pages },
  };
}
