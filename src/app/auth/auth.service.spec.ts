import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AuthSessionData, LoginResponse, RegisterRequest } from './auth.models';
import { API_CONFIG } from '../core/config/api.config';
import { AuthService } from '../core/services/auth.service';

const session: AuthSessionData = {
  auth_status: 'workspace_selected',
  user: {
    id: 'user-id',
    login_id: 'test.user',
    name: 'Test User',
    email: 'test@gmail.com',
  },
  selected_workspace: { id: 'workspace-id', name: 'Main workspace', slug: 'main' },
  role: 'owner',
  permissions: ['dashboard.read', 'tenant.users.manage'],
  workspaces: [{ id: 'workspace-id', name: 'Main workspace', slug: 'main', role: 'owner' }],
};

function loginResponse(overrides: Partial<AuthSessionData> = {}): LoginResponse {
  return {
    success: true,
    message: 'Login successful',
    data: {
      ...session,
      ...overrides,
      access_token: 'jwt-token',
      token_type: 'bearer',
    },
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuthService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    API_CONFIG.isLive = false;
    localStorage.clear();
  });

  it('posts an identifier unchanged and makes /auth/me authoritative before completing login', () => {
    let completed = false;
    service
      .login({ identifier: 'test.user', password: '  exact password  ' })
      .subscribe(() => (completed = true));

    const pending = http.expectOne(`${API_CONFIG.baseUrl}/auth/login`);
    expect(pending.request.method).toBe('POST');
    expect(pending.request.body).toEqual({
      identifier: 'test.user',
      password: '  exact password  ',
    });
    pending.flush(loginResponse());

    expect(completed).toBe(false);
    const currentSession = http.expectOne(`${API_CONFIG.baseUrl}/auth/me`);
    currentSession.flush({ success: true, data: session });

    expect(completed).toBe(true);
    expect(localStorage.getItem('access_token')).toBe('jwt-token');
    expect(localStorage.getItem('user')).toBeNull();
    expect(service.user()).toEqual(session.user);
    expect(service.role()).toBe('owner');
    expect(service.hasPermission('tenant.users.manage')).toBe(true);
  });

  it('validates a stored session with /auth/me before becoming authenticated', () => {
    localStorage.setItem('access_token', 'stored-token');
    localStorage.setItem('user', JSON.stringify(session.user));
    expect(service.isAuthenticated()).toBe(false);

    service.loadCurrentSession().subscribe((authenticated) => expect(authenticated).toBe(true));
    const pending = http.expectOne(`${API_CONFIG.baseUrl}/auth/me`);
    pending.flush({ success: true, data: session });

    expect(service.isAuthenticated()).toBe(true);
    expect(service.selectedWorkspace()).toEqual(session.selected_workspace);
  });

  it('clears token and state when /auth/me rejects the session', () => {
    localStorage.setItem('access_token', 'expired-token');
    service.loadCurrentSession().subscribe((authenticated) => expect(authenticated).toBe(false));
    http
      .expectOne(`${API_CONFIG.baseUrl}/auth/me`)
      .flush(
        { success: false, message: 'Invalid authentication credentials' },
        { status: 401, statusText: 'Unauthorized' },
      );

    expect(localStorage.getItem('access_token')).toBeNull();
    expect(service.user()).toBeNull();
    expect(service.permissions()).toEqual([]);
  });

  it('selects a workspace and replaces the scoped token and authorization state', () => {
    localStorage.setItem('access_token', 'selection-token');
    const selected = loginResponse();
    selected.data.access_token = 'workspace-token';

    service.selectWorkspace('workspace-id').subscribe();
    const pending = http.expectOne(`${API_CONFIG.baseUrl}/auth/select-workspace`);
    expect(pending.request.body).toEqual({ workspace_id: 'workspace-id' });
    pending.flush(selected);
    http.expectOne(`${API_CONFIG.baseUrl}/auth/me`).flush({ success: true, data: session });

    expect(localStorage.getItem('access_token')).toBe('workspace-token');
    expect(service.authStatus()).toBe('workspace_selected');
  });

  it('clears all authorization state on logout', () => {
    service.login({ identifier: 'test.user', password: 'secret' }).subscribe();
    http.expectOne(`${API_CONFIG.baseUrl}/auth/login`).flush(loginResponse());
    http.expectOne(`${API_CONFIG.baseUrl}/auth/me`).flush({ success: true, data: session });

    service.logout();

    expect(localStorage.getItem('access_token')).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.user()).toBeNull();
    expect(service.selectedWorkspace()).toBeNull();
    expect(service.permissions()).toEqual([]);
  });

  it('refreshes effective permissions from /auth/me after an authorization change', () => {
    service.login({ identifier: 'test.user', password: 'secret' }).subscribe();
    http.expectOne(`${API_CONFIG.baseUrl}/auth/login`).flush(loginResponse());
    http.expectOne(`${API_CONFIG.baseUrl}/auth/me`).flush({ success: true, data: session });

    const refreshed: AuthSessionData = {
      ...session,
      permissions: ['overview.view', 'settings.roles.view'],
    };
    service.refreshCurrentSession().subscribe((authenticated) => expect(authenticated).toBe(true));
    http.expectOne(`${API_CONFIG.baseUrl}/auth/me`).flush({ success: true, data: refreshed });

    expect(service.permissions()).toEqual(['overview.view', 'settings.roles.view']);
  });

  it('uses the /auth/me workspace, role, and effective permissions instead of the login payload', () => {
    const staleLogin = loginResponse({
      auth_status: 'onboarding_pending',
      selected_workspace: null,
      role: null,
      permissions: [],
      workspaces: [],
    });

    service.login({ identifier: 'test.user', password: 'secret' }).subscribe();
    http.expectOne(`${API_CONFIG.baseUrl}/auth/login`).flush(staleLogin);
    http.expectOne(`${API_CONFIG.baseUrl}/auth/me`).flush({ success: true, data: session });

    expect(service.authStatus()).toBe('workspace_selected');
    expect(service.selectedWorkspace()).toEqual(session.selected_workspace);
    expect(service.role()).toBe('owner');
    expect(service.permissions()).toEqual(session.permissions);
  });

  it('posts the registration contract to the API', () => {
    const request: RegisterRequest = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      login_id: 'jane.doe',
      password: 'StrongPass1!',
      confirm_password: 'StrongPass1!',
    };

    service.register(request).subscribe((response) => {
      expect(response.message).toBe('Registration successful');
    });

    const pending = http.expectOne(`${API_CONFIG.baseUrl}/auth/register`);
    expect(pending.request.body).toEqual(request);
    pending.flush({
      success: true,
      message: 'Registration successful',
      data: { id: 'user-id', name: 'Jane Doe', email: 'jane@example.com', login_id: 'jane.doe' },
    });
  });

  it('posts the forgot-password email to the configured API', () => {
    service.forgotPassword('test@gmail.com').subscribe();
    const pending = http.expectOne(`${API_CONFIG.baseUrl}/auth/forgot-password`);
    expect(pending.request.body).toEqual({ email: 'test@gmail.com' });
    pending.flush({ success: true, message: 'Reset link sent' });
  });

  it('posts the reset token and passwords to the configured API', () => {
    service.resetPassword('reset-token', 'new-password', 'new-password').subscribe();
    const pending = http.expectOne(`${API_CONFIG.baseUrl}/auth/reset-password`);
    expect(pending.request.body).toEqual({
      token: 'reset-token',
      new_password: 'new-password',
      confirm_password: 'new-password',
    });
    pending.flush({ success: true, message: 'Password reset successful' });
  });
});
