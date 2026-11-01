import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../../core/config/api.config';
import { PERMISSIONS } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { WhatsAppInboxComponent } from './whatsapp-inbox.component';

describe('WhatsAppInboxComponent provider initialization', () => {
  let fixture: ComponentFixture<WhatsAppInboxComponent>;
  let http: HttpTestingController;
  const twilioConversationsUrl = `${API_CONFIG.baseUrl}/messages/whatsapp/conversations?page=1&size=20`;
  const metaBaseUrl = `${API_CONFIG.baseUrl}/messages/meta/whatsapp`;
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
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  it('selects Meta automatically in a Meta-only workspace and loads only Meta conversations', () => {
    flushActiveMetaChannel();
    http
      .expectOne(twilioConversationsUrl)
      .flush(
        { detail: { message: 'Twilio WhatsApp is not configured' } },
        { status: 404, statusText: 'Not Found' },
      );

    const metaList = http.expectOne(`${metaBaseUrl}/conversations?page=1&size=20`);
    expect(metaList.request.method).toBe('GET');
    metaList.flush(emptyConversationPage());
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.single-channel')?.textContent).toContain('Meta WhatsApp');
    expect(root.textContent).toContain('Twilio WhatsApp:');
    expect(root.textContent).toContain('Twilio WhatsApp is not configured');
    expect(http.match(twilioConversationsUrl)).toHaveLength(0);
  });

  it('selects Twilio automatically when it is the only active provider', () => {
    flushInactiveMetaChannel();
    http.expectOne(twilioConversationsUrl).flush(emptyConversationPage());
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.single-channel')?.textContent).toContain(
      'Existing Twilio WhatsApp',
    );
    expect(http.match(`${metaBaseUrl}/conversations?page=1&size=20`)).toHaveLength(0);
  });

  it('keeps a valid provider selection when both providers are available', () => {
    flushActiveMetaChannel();
    http.expectOne(twilioConversationsUrl).flush(emptyConversationPage());
    (fixture.componentInstance as any).changeProvider('meta');
    http.expectOne(`${metaBaseUrl}/conversations?page=1&size=20`).flush(emptyConversationPage());

    (fixture.componentInstance as any).initializeProviders();
    flushActiveMetaChannel();
    http.expectOne(twilioConversationsUrl).flush(emptyConversationPage());

    http.expectOne(`${metaBaseUrl}/conversations?page=1&size=20`).flush(emptyConversationPage());
    fixture.detectChanges();

    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      '.channel-control select',
    );
    expect(select?.value).toBe('meta');
    expect(Array.from(select?.options ?? []).map((option) => option.value)).toEqual([
      'meta',
      'twilio',
    ]);
  });

  it('keeps Twilio available and displays a Meta discovery failure', () => {
    http
      .expectOne(`${metaBaseUrl}/channel`)
      .flush(
        { detail: { message: 'Meta channel lookup failed' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    http.expectOne(twilioConversationsUrl).flush(emptyConversationPage());
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.single-channel')?.textContent).toContain(
      'Existing Twilio WhatsApp',
    );
    expect(root.textContent).toContain('Meta WhatsApp:');
    expect(root.textContent).toContain('Meta channel lookup failed');
  });

  it('reports both provider failures without trying to load either inbox', () => {
    http
      .expectOne(`${metaBaseUrl}/channel`)
      .flush(
        { detail: { message: 'Meta discovery unavailable' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    http
      .expectOne(twilioConversationsUrl)
      .flush(
        { detail: { message: 'Twilio discovery unavailable' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('No configured WhatsApp channel available');
    expect(root.textContent).toContain('Meta WhatsApp:');
    expect(root.textContent).toContain('Twilio WhatsApp:');
    expect(http.match(`${metaBaseUrl}/conversations?page=1&size=20`)).toHaveLength(0);
  });

  function flushActiveMetaChannel(): void {
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
  }

  function flushInactiveMetaChannel(): void {
    http.expectOne(`${metaBaseUrl}/channel`).flush({
      success: true,
      message: '',
      data: {
        id: 'meta-channel-1',
        provider: 'meta',
        waba_id: 'waba-1',
        phone_number_id: 'phone-id-1',
        sender_address: '+14155550000',
        active: false,
      },
    });
  }

  function emptyConversationPage() {
    return {
      success: true,
      message: '',
      data: { items: [], page: 1, size: 20, total: 0, pages: 0 },
    };
  }
});
