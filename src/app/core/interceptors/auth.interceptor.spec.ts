import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { API_CONFIG } from '../config/api.config';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let httpClient: HttpClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    httpClient = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
    localStorage.setItem('access_token', 'jwt-token');
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('attaches the bearer token to API requests', () => {
    httpClient.get(`${API_CONFIG.baseUrl}/leads`).subscribe();

    const pending = http.expectOne(`${API_CONFIG.baseUrl}/leads`);
    expect(pending.request.headers.get('Authorization')).toBe('Bearer jwt-token');
    pending.flush({});
  });

  it('does not attach the token to public authentication requests', () => {
    httpClient.post(`${API_CONFIG.baseUrl}/auth/login`, {}).subscribe();
    httpClient.post(`${API_CONFIG.baseUrl}/auth/register`, {}).subscribe();
    httpClient.post(`${API_CONFIG.baseUrl}/auth/forgot-password`, {}).subscribe();
    httpClient.post(`${API_CONFIG.baseUrl}/auth/reset-password`, {}).subscribe();

    const login = http.expectOne(`${API_CONFIG.baseUrl}/auth/login`);
    const register = http.expectOne(`${API_CONFIG.baseUrl}/auth/register`);
    const forgotPassword = http.expectOne(`${API_CONFIG.baseUrl}/auth/forgot-password`);
    const resetPassword = http.expectOne(`${API_CONFIG.baseUrl}/auth/reset-password`);
    expect(login.request.headers.has('Authorization')).toBe(false);
    expect(register.request.headers.has('Authorization')).toBe(false);
    expect(forgotPassword.request.headers.has('Authorization')).toBe(false);
    expect(resetPassword.request.headers.has('Authorization')).toBe(false);
    login.flush({});
    register.flush({});
    forgotPassword.flush({});
    resetPassword.flush({});
  });

  it('never sends backend credentials to unrelated or lookalike origins', () => {
    const unrelated = 'https://example.com/data';
    const lookalike = 'https://myproject-v2-2.onrender.com.attacker.example/api/leads';
    httpClient.get(unrelated).subscribe();
    httpClient.get(lookalike).subscribe();

    const first = http.expectOne(unrelated);
    const second = http.expectOne(lookalike);
    expect(first.request.headers.has('Authorization')).toBe(false);
    expect(second.request.headers.has('Authorization')).toBe(false);
    first.flush({});
    second.flush({});
  });

  it('leaves mail-history permission failures on the current detail page', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    httpClient.get(`${API_CONFIG.baseUrl}/mail/messages?customer_id=customer-1`).subscribe({
      error: () => undefined,
    });

    http
      .expectOne(`${API_CONFIG.baseUrl}/mail/messages?customer_id=customer-1`)
      .flush({ detail: 'Message access is forbidden' }, { status: 403, statusText: 'Forbidden' });

    expect(navigate).not.toHaveBeenCalledWith(['/access-denied']);
  });

  it('leaves SMS permission failures in the composer for an actionable error', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    httpClient.post(`${API_CONFIG.baseUrl}/sms/send`, {}).subscribe({
      error: () => undefined,
    });

    http
      .expectOne(`${API_CONFIG.baseUrl}/sms/send`)
      .flush(
        { detail: 'Insufficient workspace permission' },
        { status: 403, statusText: 'Forbidden' },
      );

    expect(navigate).not.toHaveBeenCalledWith(['/access-denied']);
  });

  it('leaves SMS recovery permission failures in the composer for an actionable error', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    httpClient
      .get(`${API_CONFIG.baseUrl}/sms/operations/recover?idempotency_key=sms-key-0001`)
      .subscribe({ error: () => undefined });

    http
      .expectOne(`${API_CONFIG.baseUrl}/sms/operations/recover?idempotency_key=sms-key-0001`)
      .flush(
        { detail: 'Insufficient workspace permission' },
        { status: 403, statusText: 'Forbidden' },
      );

    expect(navigate).not.toHaveBeenCalledWith(['/access-denied']);
  });

  it('leaves WhatsApp action permission failures in the inbox for an actionable error', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    httpClient
      .post(`${API_CONFIG.baseUrl}/messages/whatsapp/conversations/conversation-1/reply`, {})
      .subscribe({ error: () => undefined });

    http
      .expectOne(`${API_CONFIG.baseUrl}/messages/whatsapp/conversations/conversation-1/reply`)
      .flush(
        { detail: 'Insufficient workspace permission' },
        { status: 403, statusText: 'Forbidden' },
      );

    expect(navigate).not.toHaveBeenCalledWith(['/access-denied']);
  });
});
