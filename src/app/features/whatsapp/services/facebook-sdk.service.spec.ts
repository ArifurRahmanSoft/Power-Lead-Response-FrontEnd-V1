import { TestBed } from '@angular/core/testing';

import { FacebookSdkService } from './facebook-sdk.service';

describe('FacebookSdkService', () => {
  let service: FacebookSdkService;
  const sdkWindow = window as Window & {
    FB?: { init: ReturnType<typeof vi.fn>; login: ReturnType<typeof vi.fn> };
    fbAsyncInit?: () => void;
    __powerLeadFacebookSdkState?: unknown;
  };

  beforeEach(() => {
    document.getElementById('facebook-jssdk')?.remove();
    delete sdkWindow.FB;
    delete sdkWindow.fbAsyncInit;
    delete sdkWindow.__powerLeadFacebookSdkState;
    TestBed.configureTestingModule({});
    service = TestBed.inject(FacebookSdkService);
  });

  afterEach(() => {
    document.getElementById('facebook-jssdk')?.remove();
    delete sdkWindow.FB;
    delete sdkWindow.fbAsyncInit;
    delete sdkWindow.__powerLeadFacebookSdkState;
  });

  it('loads and initializes the official SDK once for a compatible app and version', async () => {
    const first = service.load('app-1', 'v25.0');
    const script = document.getElementById('facebook-jssdk') as HTMLScriptElement;
    expect(script.src).toBe('https://connect.facebook.net/en_US/sdk.js');

    sdkWindow.FB = { init: vi.fn(), login: vi.fn() };
    sdkWindow.fbAsyncInit?.();
    await first;

    const second = service.load('app-1', 'v25.0');
    await expect(second).resolves.toBeUndefined();
    expect(sdkWindow.FB.init).toHaveBeenCalledTimes(1);
    expect(sdkWindow.FB.init).toHaveBeenCalledWith({
      appId: 'app-1',
      cookie: true,
      xfbml: false,
      version: 'v25.0',
    });
    expect(document.querySelectorAll('#facebook-jssdk')).toHaveLength(1);
  });

  it('rejects incompatible or unverifiable existing SDK initialization', async () => {
    const pending = service.load('app-1', 'v25.0');
    sdkWindow.FB = { init: vi.fn(), login: vi.fn() };
    sdkWindow.fbAsyncInit?.();
    await pending;

    await expect(service.load('app-2', 'v25.0')).rejects.toThrow(/different app/i);

    document.getElementById('facebook-jssdk')?.remove();
    delete sdkWindow.__powerLeadFacebookSdkState;
    await expect(service.load('app-1', 'v25.0')).rejects.toThrow(/cannot be verified/i);
  });

  it('passes backend login options through unchanged and surfaces popup exceptions', async () => {
    const pending = service.load('app-1', 'v25.0');
    const login = vi.fn((_callback: unknown, _options: unknown) => {
      throw new Error('Popup blocked');
    });
    sdkWindow.FB = { init: vi.fn(), login };
    sdkWindow.fbAsyncInit?.();
    await pending;

    const extras = { version: 'v4', setup: { solutionID: 'server-value' } };
    expect(() =>
      service.login(
        {
          config_id: 'config-1',
          response_type: 'code',
          override_default_response_type: true,
          extras,
        },
        () => undefined,
      ),
    ).toThrowError('Popup blocked');
    expect((login.mock.calls[0]![1] as { extras: unknown }).extras).toBe(extras);
  });
});
