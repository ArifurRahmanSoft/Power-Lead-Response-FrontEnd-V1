import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { PERMISSIONS } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import { FacebookSdkService } from '../../whatsapp/services/facebook-sdk.service';
import { MetaWhatsAppService } from '../../whatsapp/services/meta-whatsapp.service';
import { WhatsAppBusinessAppConnectComponent } from './whatsapp-business-app-connect.component';

describe('WhatsAppBusinessAppConnectComponent', () => {
  let fixture: ComponentFixture<WhatsAppBusinessAppConnectComponent>;
  let loginCallback:
    ((response: { authResponse?: { code?: string }; status?: string }) => void) | null;
  let canUpdate: boolean;
  let completeResult: Subject<any>;

  const auth = {
    hasPermission: (permission: string) =>
      permission === PERMISSIONS.settingsIntegrationsView ||
      (permission === PERMISSIONS.settingsIntegrationsUpdate && canUpdate),
  };
  const facebook = {
    load: vi.fn(() => Promise.resolve()),
    login: vi.fn((_options: unknown, callback: typeof loginCallback) => {
      loginCallback = callback;
    }),
  };
  const meta = {
    getConnectReadiness: vi.fn((): any => of(readinessResponse())),
    getChannel: vi.fn(() =>
      of({
        success: true,
        message: '',
        data: {
          id: 'channel-1',
          provider: 'meta',
          waba_id: 'waba-current',
          phone_number_id: 'phone-current',
          sender_address: '+14155550000',
          active: true,
        },
      }),
    ),
    initiateConnection: vi.fn(() => of(initiation())),
    completeConnection: vi.fn(() => completeResult.asObservable()),
    getConnectionOperation: vi.fn(() =>
      of({ success: true, message: '', data: { status: 'completed' } }),
    ),
    activateConnection: vi.fn(() =>
      of({ success: true, message: '', data: { status: 'activated' } }),
    ),
    announceChannelChanged: vi.fn(),
  };

  beforeEach(async () => {
    canUpdate = true;
    loginCallback = null;
    completeResult = new Subject();
    vi.clearAllMocks();
    meta.getConnectReadiness.mockReturnValue(of(readinessResponse()));
    meta.initiateConnection.mockReturnValue(of(initiation()));
    meta.completeConnection.mockImplementation(() => completeResult.asObservable());
    meta.getConnectionOperation.mockReturnValue(
      of({ success: true, message: '', data: { status: 'completed' } }),
    );
    meta.activateConnection.mockReturnValue(
      of({ success: true, message: '', data: { status: 'activated' } }),
    );
    facebook.load.mockReturnValue(Promise.resolve());
    facebook.login.mockImplementation((_options: unknown, callback: typeof loginCallback) => {
      loginCallback = callback;
    });

    await TestBed.configureTestingModule({
      imports: [WhatsAppBusinessAppConnectComponent],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: MetaWhatsAppService, useValue: meta },
        { provide: FacebookSdkService, useValue: facebook },
        provideRouter([]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(WhatsAppBusinessAppConnectComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => fixture?.destroy());

  it('uses the exact readiness envelope once and gates the action by update permission', async () => {
    const readyRoot = fixture.nativeElement as HTMLElement;
    expect(findButton('Connect WhatsApp Business App').disabled).toBe(false);
    expect(readyRoot.textContent).toContain('Configuration ready');
    expect(readyRoot.textContent).toContain(
      'does not mean a WhatsApp account is connected or subscribed',
    );

    canUpdate = false;
    await recreateWithReadiness(of(readinessResponse()));

    const root = fixture.nativeElement as HTMLElement;
    const button = findButton('Connect WhatsApp Business App');
    expect(button.disabled).toBe(true);
    expect(root.textContent).toContain('settings.integrations.update');
  });

  it('blocks readiness=false and displays exact missing and invalid setting names', async () => {
    const response = readinessResponse({
      settings: readinessResponse().data.settings.map((setting) =>
        setting.name === 'META_WHATSAPP_APP_ID'
          ? { ...setting, present: false, format_valid: false }
          : setting.name === 'META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID'
            ? { ...setting, format_valid: false }
            : setting,
      ),
      missing_settings: ['META_WHATSAPP_APP_ID'],
      invalid_settings: ['META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID'],
      oauth_configuration_ready: false,
    });
    await recreateWithReadiness(of(response));

    const root = fixture.nativeElement as HTMLElement;
    expect(findButton('Connect WhatsApp Business App').disabled).toBe(true);
    expect(root.textContent).toContain('Missing required setting: META_WHATSAPP_APP_ID.');
    expect(root.textContent).toContain(
      'Invalid setting format: META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID.',
    );
  });

  it('rejects a malformed or missing oauth_configuration_ready value', async () => {
    const response = readinessResponse() as any;
    delete response.data.oauth_configuration_ready;
    await recreateWithReadiness(of(response));

    const root = fixture.nativeElement as HTMLElement;
    expect(findButton('Connect WhatsApp Business App').disabled).toBe(true);
    expect(root.textContent).toContain('data.oauth_configuration_ready must be a boolean');
  });

  it.each([
    [401, 'Authentication required'],
    [403, 'Integration permission denied'],
    [503, 'Readiness service unavailable'],
  ])('blocks onboarding and renders HTTP %s readiness errors', async (status, detail) => {
    await recreateWithReadiness(
      throwError(
        () =>
          new HttpErrorResponse({
            status,
            statusText: 'Error',
            error: { detail },
          }),
      ),
    );

    const root = fixture.nativeElement as HTMLElement;
    expect(findButton('Connect WhatsApp Business App').disabled).toBe(true);
    expect(root.textContent).toContain(detail);
  });

  it('submits once when the code arrives before the session event', async () => {
    await launch();
    loginCallback?.({ authResponse: { code: 'secret-code' } });
    expect(meta.completeConnection).not.toHaveBeenCalled();

    dispatchSession('https://www.facebook.com');
    expect(meta.completeConnection).toHaveBeenCalledTimes(1);
    expect((meta.completeConnection.mock.calls as unknown[][])[0][0]).toEqual({
      operation_id: 'operation-1',
      state: 'one-time-state',
      code: 'secret-code',
      session: {
        event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
        business_id: 'business-1',
        waba_id: 'waba-1',
        phone_number_id: 'phone-1',
      },
    });
  });

  it('accepts the reverse event order and ignores duplicates', async () => {
    await launch();
    dispatchSession('https://web.facebook.com');
    dispatchSession('https://web.facebook.com');
    expect(meta.completeConnection).not.toHaveBeenCalled();
    loginCallback?.({ authResponse: { code: 'secret-code' } });
    loginCallback?.({ authResponse: { code: 'secret-code' } });
    expect(meta.completeConnection).toHaveBeenCalledTimes(1);
  });

  it('rejects non-exact origins and malformed completion events', async () => {
    await launch();
    loginCallback?.({ authResponse: { code: 'secret-code' } });
    dispatchSession('https://www.facebook.com.evil.test');
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://www.facebook.com',
        data: {
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
          data: { waba_id: 'waba-1' },
        },
        source: window,
      }),
    );
    fixture.detectChanges();
    expect(meta.completeConnection).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'data.waba_id and data.phone_number_id',
    );

    dispatchSession('https://www.facebook.com');
    expect(meta.completeConnection).toHaveBeenCalledTimes(1);
  });

  it('handles popup blocking, cancellation, expiry, and listener cleanup', async () => {
    facebook.login.mockImplementationOnce(() => {
      throw new Error('Popup blocked');
    });
    await launch();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Popup blocked');

    await launch();
    loginCallback?.({ status: 'unknown' });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('cancelled or closed');

    meta.initiateConnection.mockReturnValueOnce(
      of(initiation(new Date(Date.now() - 1000).toISOString())),
    );
    findButton('Connect WhatsApp Business App').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('operation expired');

    meta.initiateConnection.mockReturnValueOnce(of(initiation()));
    await launch();
    fixture.destroy();
    dispatchSession('https://www.facebook.com');
    loginCallback?.({ authResponse: { code: 'secret-code' } });
    expect(meta.completeConnection).not.toHaveBeenCalled();
  });

  it('recovers an uncertain completion with GET only and reports a missing status schema', async () => {
    meta.completeConnection.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable' })),
    );
    meta.getConnectionOperation.mockReturnValueOnce(
      of({ success: true, message: '', data: {} }) as any,
    );
    await launchAndCompleteInputs();
    fixture.detectChanges();

    expect(meta.completeConnection).toHaveBeenCalledTimes(1);
    expect(meta.getConnectionOperation).toHaveBeenCalledTimes(1);
    expect(meta.activateConnection).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'operation response is missing data.status',
    );
  });

  it('requires explicit sender replacement confirmation and refreshes after success', async () => {
    await launchAndCompleteInputs();
    completeResult.next({
      success: true,
      message: '',
      data: {
        status: 'confirmation_required',
        confirmation_required: true,
        current_sender: { address: '+14155550000' },
        new_sender: { address: '+14155551111' },
      },
    });
    completeResult.complete();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Old conversation history remains preserved');
    expect(root.textContent).toContain('+14155551111');
    expect(meta.activateConnection).not.toHaveBeenCalled();

    findButton('Confirm sender change').click();
    fixture.detectChanges();
    expect(meta.activateConnection).toHaveBeenCalledWith('operation-1');
    expect(meta.announceChannelChanged).toHaveBeenCalledTimes(1);
    expect(meta.getConnectReadiness.mock.calls.length).toBeGreaterThan(1);
    expect(meta.getChannel.mock.calls.length).toBeGreaterThan(1);
    expect(root.textContent).toContain(
      'Existing conversations remain in their original provider history',
    );
  });

  async function launch(): Promise<void> {
    findButton('Connect WhatsApp Business App').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    findButton('Continue with Facebook').click();
    fixture.detectChanges();
  }

  async function recreateWithReadiness(source: any): Promise<void> {
    fixture.destroy();
    meta.getConnectReadiness.mockReturnValue(source);
    fixture = TestBed.createComponent(WhatsAppBusinessAppConnectComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function launchAndCompleteInputs(): Promise<void> {
    await launch();
    dispatchSession('https://www.facebook.com');
    loginCallback?.({ authResponse: { code: 'secret-code' } });
  }

  function findButton(label: string): HTMLButtonElement {
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    );
    const button = buttons.find((candidate) => candidate.textContent?.trim() === label);
    if (!button) throw new Error(`Button not found: ${label}`);
    return button;
  }

  function dispatchSession(origin: string): void {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin,
        source: window,
        data: {
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
          data: {
            business_id: 'business-1',
            waba_id: 'waba-1',
            phone_number_id: 'phone-1',
          },
        },
      }),
    );
  }
});

function initiation(expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return {
    success: true,
    message: '',
    data: {
      operation_id: 'operation-1',
      state: 'one-time-state',
      expires_at: expiresAt,
      launch_mode: 'facebook_js_sdk' as const,
      app_id: 'app-from-backend',
      configuration_id: 'configuration-from-backend',
      graph_api_version: 'v25.0',
      response_type: 'code' as const,
      override_default_response_type: true as const,
      extras: { version: 'v4', setup: { server: 'unchanged' } },
    },
  };
}

function readinessResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    message: 'Meta WhatsApp onboarding readiness retrieved',
    data: {
      settings: [
        'META_WHATSAPP_APP_ID',
        'META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID',
        'META_WHATSAPP_OAUTH_REDIRECT_URI',
        'META_APP_SECRET',
        'SMTP_CREDENTIAL_ENCRYPTION_KEY',
        'META_GRAPH_API_VERSION',
      ].map((name) => ({ name, present: true, format_valid: true })),
      missing_settings: [],
      invalid_settings: [],
      oauth_configuration_ready: true,
      onboarding_mode: 'facebook_js_sdk' as const,
      coexistence_requested: true,
      hosted_signup_supports_coexistence_customization: false,
      callback_contract: 'authenticated_code_handoff' as const,
      ...overrides,
    },
  };
}
