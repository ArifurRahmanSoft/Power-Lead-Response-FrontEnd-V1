import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

export interface FacebookLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

export interface FacebookEmbeddedSignupOptions {
  config_id: string;
  response_type: 'code';
  override_default_response_type: true;
  extras: Readonly<Record<string, unknown>>;
}

interface FacebookSdkApi {
  init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: FacebookEmbeddedSignupOptions,
  ): void;
}

interface FacebookSdkWindow extends Window {
  FB?: FacebookSdkApi;
  fbAsyncInit?: () => void;
  __powerLeadFacebookSdkState?: FacebookSdkState;
}

interface FacebookSdkState {
  appId: string;
  version: string;
  initialized: boolean;
  promise: Promise<void>;
}

const FACEBOOK_SDK_ID = 'facebook-jssdk';
const FACEBOOK_SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';

@Injectable({ providedIn: 'root' })
export class FacebookSdkService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  load(appId: string, version: string): Promise<void> {
    if (!this.isBrowser) return Promise.reject(new Error('Facebook signup is browser-only.'));
    const sdkWindow = this.document.defaultView as FacebookSdkWindow | null;
    if (!sdkWindow) return Promise.reject(new Error('The browser window is unavailable.'));

    const existingState = sdkWindow.__powerLeadFacebookSdkState;
    if (existingState) {
      try {
        this.assertCompatible(existingState, appId, version);
      } catch (error) {
        return Promise.reject(error);
      }
      return existingState.promise;
    }

    if (sdkWindow.FB || sdkWindow.fbAsyncInit || this.document.getElementById(FACEBOOK_SDK_ID)) {
      return Promise.reject(
        new Error(
          'Facebook SDK is already present, but its initialized app ID and Graph API version cannot be verified.',
        ),
      );
    }

    let resolveLoad!: () => void;
    let rejectLoad!: (reason: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveLoad = resolve;
      rejectLoad = reject;
    });
    const state: FacebookSdkState = { appId, version, initialized: false, promise };
    sdkWindow.__powerLeadFacebookSdkState = state;

    let settled = false;
    const initialize = () => {
      if (settled || state.initialized) return;
      if (!sdkWindow.FB) return;
      try {
        sdkWindow.FB.init({ appId, cookie: true, xfbml: false, version });
        state.initialized = true;
        settled = true;
        resolveLoad();
      } catch (error) {
        settled = true;
        rejectLoad(error);
      }
    };

    sdkWindow.fbAsyncInit = initialize;
    const script = this.document.createElement('script');
    script.id = FACEBOOK_SDK_ID;
    script.async = true;
    script.defer = true;
    script.src = FACEBOOK_SDK_URL;
    script.onload = initialize;
    script.onerror = () => {
      if (settled) return;
      settled = true;
      script.remove();
      delete sdkWindow.__powerLeadFacebookSdkState;
      delete sdkWindow.fbAsyncInit;
      rejectLoad(new Error('The official Facebook JavaScript SDK could not be loaded.'));
    };
    (this.document.head ?? this.document.body).appendChild(script);

    return promise;
  }

  login(
    options: FacebookEmbeddedSignupOptions,
    callback: (response: FacebookLoginResponse) => void,
  ): void {
    const sdkWindow = this.document.defaultView as FacebookSdkWindow | null;
    const state = sdkWindow?.__powerLeadFacebookSdkState;
    if (!sdkWindow?.FB || !state?.initialized) {
      throw new Error('Facebook SDK is not ready. Prepare the connection again.');
    }
    sdkWindow.FB.login(callback, options);
  }

  private assertCompatible(state: FacebookSdkState, appId: string, version: string): void {
    if (state.appId === appId && state.version === version) return;
    throw new Error(
      `Facebook SDK is already initialized with a different app or Graph API version (existing version: ${state.version}). Reload before starting this connection.`,
    );
  }
}
