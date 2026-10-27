import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../../core/config/api.config';
import { PERMISSIONS } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { MetaWhatsAppConversation, MetaWhatsAppMessage } from '../../models/meta-whatsapp.models';
import { WhatsAppConversation, WhatsAppMessage } from '../../models/whatsapp.models';
import { WhatsAppInboxComponent } from './whatsapp-inbox.component';

describe('WhatsAppInboxComponent', () => {
  let fixture: ComponentFixture<WhatsAppInboxComponent>;
  let http: HttpTestingController;
  const baseUrl = `${API_CONFIG.baseUrl}/messages/whatsapp`;
  const metaBaseUrl = `${API_CONFIG.baseUrl}/messages/meta/whatsapp`;
  const conversationOne = conversation('conversation-1', 'Amina Rahman');
  const conversationTwo = conversation('conversation-2', 'রহিম');
  const auth = {
    hasPermission: (permission: string) =>
      permission === PERMISSIONS.messagesView || permission === PERMISSIONS.messagesSend,
    isAuthenticated: () => true,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WhatsAppInboxComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WhatsAppInboxComponent);
    fixture.detectChanges();
    http.expectOne(`${metaBaseUrl}/channel`).flush({
      success: true,
      message: '',
      data: {
        id: 'meta-channel-1',
        provider: 'meta',
        waba_id: 'waba-1',
        phone_number_id: 'phone-id-1',
        sender_address: '+14155550000',
        active: true,
      },
    });
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  it('renders incoming/outgoing messages and exact backend statuses', () => {
    flushInitial(
      [conversationOne],
      [
        message('message-2', 'outbound', 'queued', 'Thanks'),
        message('message-1', 'inbound', 'delivered', '<strong>Hello</strong>'),
      ],
    );
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const bubbles = Array.from(root.querySelectorAll<HTMLElement>('.message-bubble'));
    expect(bubbles).toHaveLength(2);
    expect(root.textContent).toContain('<strong>Hello</strong>');
    expect(root.textContent).toContain('Queued');
    expect(root.textContent).not.toContain('DeliveredThanks');
  });

  it('preserves per-conversation Unicode drafts while switching chats', () => {
    flushInitial([conversationOne, conversationTwo], []);
    enterDraft('প্রথম খসড়া\nদ্বিতীয় লাইন');

    const root = fixture.nativeElement as HTMLElement;
    const items = Array.from(root.querySelectorAll<HTMLButtonElement>('.conversation-item'));
    items.find((item) => item.textContent?.includes('রহিম'))!.click();
    fixture.detectChanges();
    flushMessages(conversationTwo, []);
    enterDraft('Second contact');

    Array.from(root.querySelectorAll<HTMLButtonElement>('.conversation-item'))
      .find((item) => item.textContent?.includes('Amina'))!
      .click();
    fixture.detectChanges();
    flushMessages(conversationOne, []);
    fixture.detectChanges();
    expect(root.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
      'প্রথম খসড়া\nদ্বিতীয় লাইন',
    );
  });

  it('prevents duplicate clicks and preserves the draft after definitive failure', () => {
    flushInitial([conversationOne], []);
    enterDraft('বাংলা\nSecond line');
    const sendButton = findButton('Send');
    sendButton.click();
    sendButton.click();

    const requests = http.match(`${baseUrl}/conversations/conversation-1/reply`);
    expect(requests).toHaveLength(1);
    expect(requests[0].request.body.body).toBe('বাংলা\nSecond line');
    expect(requests[0].request.body.idempotency_key).toMatch(/^twilio-wa-/);
    requests[0].flush(
      { detail: { message: 'The 24-hour service window is closed' } },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('textarea')?.value,
    ).toBe('বাংলা\nSecond line');
  });

  it('uses read-only recovery after an uncertain send and does not resend', () => {
    flushInitial([conversationOne], []);
    enterDraft('Check this once');
    findButton('Send').click();
    const send = http.expectOne(`${baseUrl}/conversations/conversation-1/reply`);
    const originalKey = send.request.body.idempotency_key as string;
    send.error(new ProgressEvent('network error'));
    fixture.detectChanges();

    findButton('Check Result').click();
    const recovery = http.expectOne(
      `${baseUrl}/operations/recover?idempotency_key=${encodeURIComponent(originalKey)}`,
    );
    expect(recovery.request.method).toBe('GET');
    expect(http.match(`${baseUrl}/conversations/conversation-1/reply`)).toHaveLength(0);
    recovery.flush({
      success: true,
      message: '',
      data: {
        idempotency_key: originalKey,
        found: true,
        operation_state: 'completed',
        message: message('recovered-message', 'outbound', 'accepted', 'Check this once'),
      },
    });
    const refresh = http.expectOne(`${baseUrl}/conversations?page=1&size=20`);
    refresh.flush(conversationResponse([conversationOne]));
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('textarea')?.value,
    ).toBe('');
  });

  it('marks unread messages read only for the active visible conversation', () => {
    const unread = { ...conversationOne, unread_count: 2 };
    http.expectOne(`${baseUrl}/conversations?page=1&size=20`).flush(conversationResponse([unread]));
    fixture.detectChanges();
    flushMessages(unread, [message('message-1', 'inbound', 'unknown', 'New')]);
    const read = http.expectOne(`${baseUrl}/conversations/conversation-1/read`);
    expect(read.request.method).toBe('POST');
    read.flush({
      success: true,
      message: '',
      data: {
        conversation_id: conversationOne.id,
        unread_count: 0,
        last_read_at: '2026-10-22T05:02:00Z',
      },
    });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.unread-badge')).toBeNull();
  });

  it('disables free-form sending after service-window expiry', () => {
    const closed = {
      ...conversationOne,
      free_form_reply_allowed: false,
      service_window_expires_at: '2026-10-21T05:00:00Z',
    };
    flushInitial([closed], []);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Service window closed');
    expect(root.textContent).toContain('cannot send arbitrary text');
    expect(root.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true);
    findButton('Send').click();
    expect(http.match(`${baseUrl}/conversations/conversation-1/reply`)).toHaveLength(0);
  });

  it('switches providers and ignores a late Twilio list response', () => {
    const staleTwilio = http.expectOne(`${baseUrl}/conversations?page=1&size=20`);
    switchProvider('meta');
    const metaList = http.expectOne(`${metaBaseUrl}/conversations?page=1&size=20`);
    const metaConversation = metaConversationData('meta-conversation-1', true);
    metaList.flush(metaConversationResponse([metaConversation]));
    fixture.detectChanges();
    flushMetaMessages(metaConversation, []);
    staleTwilio.flush(conversationResponse([conversationOne]));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('+14155550123');
    expect(root.textContent).not.toContain('Amina Rahman');
    expect(root.textContent).toContain('Sender +14155550000');
  });

  it('opens a Meta conversation without sending and reuses the returned conversation', () => {
    flushTwilioEmptyAndSwitchToMeta([]);
    findButton('New Chat').click();
    fixture.detectChanges();
    http.expectOne(`${API_CONFIG.baseUrl}/leads?page=1&size=50`).flush({
      success: true,
      data: { items: [], page: 1, size: 50, total: 0 },
    });
    const phone = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[type="tel"]',
    )!;
    phone.value = '+14155550123';
    phone.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    findButton('Continue / Open Conversation').click();
    const opened = http.expectOne(`${metaBaseUrl}/conversations/open`);
    expect(opened.request.body).toEqual({ phone_number: '+14155550123' });
    expect(http.match(`${metaBaseUrl}/send`)).toHaveLength(0);
    const existing = metaConversationData('existing-meta-conversation', true);
    opened.flush({ success: true, message: '', data: existing });
    fixture.detectChanges();
    flushMetaMessages(existing, []);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('+14155550123');
    expect(http.match(`${metaBaseUrl}/send`)).toHaveLength(0);
  });

  it('sends open-window Meta text once and keeps accepted separate from delivery', () => {
    const current = metaConversationData('meta-conversation-1', true);
    flushTwilioEmptyAndSwitchToMeta([current]);
    flushMetaMessages(current, []);
    enterDraft('Meta hello');
    const sendButton = findButton('Send');
    sendButton.click();
    sendButton.click();
    const sends = http.match(`${metaBaseUrl}/send`);
    expect(sends).toHaveLength(1);
    expect(sends[0].request.body).toMatchObject({
      conversation_id: current.id,
      mode: 'text',
      text: 'Meta hello',
      purpose: 'lead_acquisition',
    });
    expect(sends[0].request.body.idempotency_key).toMatch(/^meta-wa-/);
    sends[0].flush({
      success: true,
      message: '',
      data: {
        message: metaMessageData('meta-message-1', current.id, 'accepted', 'Meta hello'),
        replayed: false,
        operation_state: 'completed',
      },
    });
    http
      .expectOne(`${metaBaseUrl}/conversations?page=1&size=20`)
      .flush(metaConversationResponse([current]));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Accepted');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Delivery and read status will update separately',
    );
  });

  it('requires approved Meta template variables and sends the selected language explicitly', () => {
    const current = metaConversationData('meta-closed-1', false, true);
    flushTwilioEmptyAndSwitchToMeta([current]);
    const history = http.expectOne(
      `${metaBaseUrl}/conversations/${current.id}/messages?page=1&size=50`,
    );
    const templates = http.expectOne(`${metaBaseUrl}/templates?page=1&size=100`);
    history.flush(metaMessageResponse(current, []));
    templates.flush({
      success: true,
      message: '',
      data: {
        items: [
          {
            id: 'template-1',
            name: 'lead_intro',
            language: 'en_US',
            category: 'MARKETING',
            provider_status: 'APPROVED',
            usable: true,
            components: [{ type: 'BODY', text: 'Hi {{1}}, welcome to {{2}}' }],
            required_variables: [
              { component: 'body', index: 1 },
              { component: 'body', index: 2 },
            ],
          },
        ],
        page: 1,
        size: 100,
        total: 1,
        pages: 1,
      },
    });
    fixture.detectChanges();
    const send = findButton('Send template');
    expect(send.disabled).toBe(true);
    const variables = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
        '.variable-grid input',
      ),
    );
    for (const [index, input] of variables.entries()) {
      input.value = index === 0 ? 'Arif' : 'PowerLead';
      input.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();
    expect(findButton('Send template').disabled).toBe(false);
    findButton('Send template').click();
    const request = http.expectOne(`${metaBaseUrl}/send`);
    expect(request.request.body).toMatchObject({
      conversation_id: current.id,
      mode: 'approved_template',
      template: {
        name: 'lead_intro',
        language: 'en_US',
        parameters: [
          { component: 'body', index: 1, value: 'Arif' },
          { component: 'body', index: 2, value: 'PowerLead' },
        ],
      },
    });
  });

  it('shows backend consent restrictions and blocks template sending', () => {
    const current = metaConversationData('meta-blocked-1', false, false);
    flushTwilioEmptyAndSwitchToMeta([current]);
    http
      .expectOne(`${metaBaseUrl}/conversations/${current.id}/messages?page=1&size=50`)
      .flush(metaMessageResponse(current, []));
    http.expectOne(`${metaBaseUrl}/templates?page=1&size=100`).flush({
      success: true,
      message: '',
      data: {
        items: [
          {
            id: 'template-1',
            name: 'lead_intro',
            language: 'en_US',
            category: 'MARKETING',
            provider_status: 'APPROVED',
            usable: true,
            components: [{ type: 'BODY', text: 'Hello' }],
            required_variables: [],
          },
        ],
        page: 1,
        size: 100,
        total: 1,
        pages: 1,
      },
    });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Recorded WhatsApp opt-in is required.',
    );
    expect(findButton('Send template').disabled).toBe(true);
    findButton('Send template').click();
    expect(http.match(`${metaBaseUrl}/send`)).toHaveLength(0);
  });

  it('recovers an uncertain Meta send with GET only and preserves the original key', () => {
    const current = metaConversationData('meta-recovery-1', true);
    flushTwilioEmptyAndSwitchToMeta([current]);
    flushMetaMessages(current, []);
    enterDraft('Recover Meta once');
    findButton('Send').click();
    const send = http.expectOne(`${metaBaseUrl}/send`);
    const originalKey = send.request.body.idempotency_key as string;
    send.error(new ProgressEvent('network error'));
    fixture.detectChanges();
    findButton('Check Result').click();
    const recovery = http.expectOne(
      `${metaBaseUrl}/operations/recover?idempotency_key=${encodeURIComponent(originalKey)}`,
    );
    expect(recovery.request.method).toBe('GET');
    expect(http.match(`${metaBaseUrl}/send`)).toHaveLength(0);
    recovery.flush({
      success: true,
      message: '',
      data: {
        idempotency_key: originalKey,
        found: true,
        operation_state: 'completed',
        message: metaMessageData('meta-recovered', current.id, 'accepted', 'Recover Meta once'),
      },
    });
    http
      .expectOne(`${metaBaseUrl}/conversations?page=1&size=20`)
      .flush(metaConversationResponse([current]));
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('textarea')?.value,
    ).toBe('');
  });

  function flushInitial(conversations: WhatsAppConversation[], messages: WhatsAppMessage[]): void {
    http
      .expectOne(`${baseUrl}/conversations?page=1&size=20`)
      .flush(conversationResponse(conversations));
    fixture.detectChanges();
    if (conversations[0]) flushMessages(conversations[0], messages);
    fixture.detectChanges();
  }

  function flushTwilioEmptyAndSwitchToMeta(conversations: MetaWhatsAppConversation[]): void {
    http.expectOne(`${baseUrl}/conversations?page=1&size=20`).flush(conversationResponse([]));
    fixture.detectChanges();
    switchProvider('meta');
    http
      .expectOne(`${metaBaseUrl}/conversations?page=1&size=20`)
      .flush(metaConversationResponse(conversations));
    fixture.detectChanges();
  }

  function switchProvider(provider: 'meta' | 'twilio'): void {
    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      '.channel-control select',
    )!;
    select.value = provider;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function flushMetaMessages(
    current: MetaWhatsAppConversation,
    messages: MetaWhatsAppMessage[],
  ): void {
    http
      .expectOne(`${metaBaseUrl}/conversations/${current.id}/messages?page=1&size=50`)
      .flush(metaMessageResponse(current, messages));
    fixture.detectChanges();
  }

  function flushMessages(current: WhatsAppConversation, messages: WhatsAppMessage[]): void {
    http.expectOne(`${baseUrl}/conversations/${current.id}/messages?page=1&size=50`).flush({
      success: true,
      message: '',
      data: {
        conversation: current,
        items: messages,
        page: 1,
        size: 50,
        total: messages.length,
        pages: messages.length ? 1 : 0,
      },
    });
  }

  function enterDraft(value: string): void {
    fixture.detectChanges();
    const textarea = (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>(
      'textarea',
    )!;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function findButton(label: string): HTMLButtonElement {
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((item) => item.textContent?.includes(label));
    if (!button) throw new Error(`Button not found: ${label}`);
    return button;
  }
});

function conversation(id: string, name: string): WhatsAppConversation {
  return {
    id,
    external_address: 'whatsapp:+8801700000000',
    lead_id: null,
    customer_id: null,
    contact_name: name,
    last_message_at: '2026-10-22T05:00:00Z',
    last_message_preview: 'Hello',
    unread_count: 0,
    free_form_reply_allowed: true,
    service_window_expires_at: '2026-10-23T05:00:00Z',
  };
}

function message(
  id: string,
  direction: 'inbound' | 'outbound',
  status: WhatsAppMessage['status'],
  body: string,
): WhatsAppMessage {
  return {
    id,
    conversation_id: 'conversation-1',
    direction,
    body,
    media: [],
    status,
    provider_message_sid: null,
    provider_error_code: null,
    failure_reason: null,
    requested_by_user_id: null,
    occurred_at: id.endsWith('1') ? '2026-10-22T05:00:00Z' : '2026-10-22T05:01:00Z',
    completed_at: null,
  };
}

function conversationResponse(items: WhatsAppConversation[]) {
  return {
    success: true,
    message: '',
    data: { items, page: 1, size: 20, total: items.length, pages: items.length ? 1 : 0 },
  };
}

function metaConversationData(
  id: string,
  freeFormAllowed: boolean,
  templateOutreachAllowed = false,
): MetaWhatsAppConversation {
  return {
    id,
    external_address: '+14155550123',
    lead_id: null,
    customer_id: null,
    contact_name: null,
    last_message_at: '2026-10-24T05:00:00Z',
    last_message_preview: null,
    unread_count: 0,
    eligibility: {
      free_form_allowed: freeFormAllowed,
      service_window_expires_at: freeFormAllowed ? '2026-10-25T05:00:00Z' : null,
      approved_template_required: !freeFormAllowed,
      template_outreach_allowed: templateOutreachAllowed,
      restrictions: templateOutreachAllowed
        ? []
        : [{ code: 'whatsapp_opt_in_required', message: 'Recorded WhatsApp opt-in is required.' }],
    },
  };
}

function metaConversationResponse(items: MetaWhatsAppConversation[]) {
  return {
    success: true,
    message: '',
    data: { items, page: 1, size: 20, total: items.length, pages: items.length ? 1 : 0 },
  };
}

function metaMessageResponse(current: MetaWhatsAppConversation, items: MetaWhatsAppMessage[]) {
  return {
    success: true,
    message: '',
    data: {
      conversation: current,
      items,
      page: 1,
      size: 50,
      total: items.length,
      pages: items.length ? 1 : 0,
    },
  };
}

function metaMessageData(
  id: string,
  conversationId: string,
  status: MetaWhatsAppMessage['status'],
  body: string,
): MetaWhatsAppMessage {
  return {
    id,
    conversation_id: conversationId,
    direction: 'outbound',
    provider: 'meta',
    mode: 'text',
    purpose: 'lead_acquisition',
    body,
    media: [],
    status,
    provider_message_id: 'wamid.1',
    provider_error_code: null,
    failure_reason: null,
    requested_by_user_id: 'user-1',
    occurred_at: '2026-10-24T05:01:00Z',
    completed_at: null,
  };
}
