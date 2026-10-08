import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { computed, Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import {
  catchError,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
} from 'rxjs';

import {
  AuthSessionData,
  AuthStatus,
  AuthUser,
  ForgotPasswordRequest,
  LoginRequest,
  LoginResponse,
  MeResponse,
  PasswordResetResponse,
  PermissionKey,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordRequest,
  SelectedWorkspace,
  WorkspaceChoice,
  WorkspaceRole,
} from '../models/auth.models';
import { API_CONFIG } from '../config/api.config';

const ACCESS_TOKEN_KEY = 'access_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private initializationRequest: Observable<boolean> | null = null;

  private readonly initializedState = signal(false);
  private readonly userState = signal<AuthUser | null>(null);
  private readonly workspaceState = signal<SelectedWorkspace | null>(null);
  private readonly roleState = signal<WorkspaceRole | null>(null);
  private readonly permissionsState = signal<readonly PermissionKey[]>([]);
  private readonly workspacesState = signal<readonly WorkspaceChoice[]>([]);
  private readonly authStatusState = signal<AuthStatus | null>(null);

  readonly initialized = this.initializedState.asReadonly();
  readonly user = this.userState.asReadonly();
  readonly selectedWorkspace = this.workspaceState.asReadonly();
  readonly role = this.roleState.asReadonly();
  readonly permissions = this.permissionsState.asReadonly();
  readonly workspaces = this.workspacesState.asReadonly();
  readonly authStatus = this.authStatusState.asReadonly();
  readonly authenticated = computed(() => this.initializedState() && this.userState() !== null);

  login(request: LoginRequest): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${API_CONFIG.baseUrl}/auth/login`, request)
      .pipe(switchMap((response) => this.establishSession(response)));
  }

  register(request: RegisterRequest): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${API_CONFIG.baseUrl}/auth/register`, request);
  }

  selectWorkspace(workspaceId: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${API_CONFIG.baseUrl}/auth/select-workspace`, {
        workspace_id: workspaceId,
      })
      .pipe(switchMap((response) => this.establishSession(response)));
  }

  loadCurrentSession(): Observable<boolean> {
    if (this.initializedState()) return of(this.authenticated());
    if (this.initializationRequest) return this.initializationRequest;

    if (!this.getAccessToken()) {
      this.clearMemoryState();
      this.initializedState.set(true);
      return of(false);
    }

    this.initializationRequest = this.requestCurrentSession().pipe(
      finalize(() => {
        this.initializedState.set(true);
        this.initializationRequest = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.initializationRequest;
  }

  refreshCurrentSession(): Observable<boolean> {
    if (!this.getAccessToken()) {
      this.clearInvalidSession();
      return of(false);
    }
    return this.requestCurrentSession();
  }

  private requestCurrentSession(): Observable<boolean> {
    return this.fetchCurrentSession().pipe(
      map(() => true),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
          this.clearSession();
        } else {
          this.clearMemoryState();
        }
        return of(false);
      }),
    );
  }

  private fetchCurrentSession(): Observable<MeResponse> {
    return this.http
      .get<MeResponse>(`${API_CONFIG.baseUrl}/auth/me`)
      .pipe(tap((response) => this.applySession(response.data)));
  }

  private establishSession(response: LoginResponse): Observable<LoginResponse> {
    this.removeStorage('user');
    this.writeStorage(ACCESS_TOKEN_KEY, response.data.access_token);
    this.clearMemoryState();
    this.initializedState.set(false);

    return this.fetchCurrentSession().pipe(
      map(() => response),
      catchError((error: unknown) => {
        // A login is not complete until the token has produced a current backend
        // authorization snapshot. Never retain a token whose session could not be verified.
        this.clearSession();
        return throwError(() => error);
      }),
      finalize(() => this.initializedState.set(true)),
    );
  }

  forgotPassword(email: string): Observable<PasswordResetResponse> {
    const request: ForgotPasswordRequest = { email };
    return this.http.post<PasswordResetResponse>(
      `${API_CONFIG.baseUrl}/auth/forgot-password`,
      request,
    );
  }

  resetPassword(
    token: string,
    new_password: string,
    confirm_password: string,
  ): Observable<PasswordResetResponse> {
    const request: ResetPasswordRequest = { token, new_password, confirm_password };
    return this.http.post<PasswordResetResponse>(
      `${API_CONFIG.baseUrl}/auth/reset-password`,
      request,
    );
  }

  getAccessToken(): string | null {
    return this.readStorage(ACCESS_TOKEN_KEY);
  }

  getCurrentUser(): AuthUser | null {
    return this.userState();
  }

  isAuthenticated(): boolean {
    return this.authenticated();
  }

  hasPermission(permission: PermissionKey): boolean {
    return this.permissionsState().includes(permission);
  }

  hasEveryPermission(permissions: readonly PermissionKey[]): boolean {
    return permissions.every((permission) => this.hasPermission(permission));
  }

  hasAnyPermission(permissions: readonly PermissionKey[]): boolean {
    return permissions.some((permission) => this.hasPermission(permission));
  }

  logout(): void {
    this.clearSession();
    this.initializedState.set(true);
  }

  clearInvalidSession(): void {
    this.clearSession();
    this.initializedState.set(true);
  }

  private applySession(data: AuthSessionData): void {
    this.userState.set(data.user);
    this.workspaceState.set(data.selected_workspace);
    this.roleState.set(data.role);
    this.permissionsState.set([...data.permissions]);
    this.workspacesState.set([...data.workspaces]);
    this.authStatusState.set(data.auth_status);
  }

  private clearSession(): void {
    this.removeStorage(ACCESS_TOKEN_KEY);
    this.clearMemoryState();
  }

  private clearMemoryState(): void {
    this.userState.set(null);
    this.workspaceState.set(null);
    this.roleState.set(null);
    this.permissionsState.set([]);
    this.workspacesState.set([]);
    this.authStatusState.set(null);
  }

  private readStorage(key: string): string | null {
    if (!this.isBrowser) return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeStorage(key: string, value: string): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
  }

  private removeStorage(key: string): void {
    if (!this.isBrowser) return;
    try {
      localStorage.removeItem(key);
      // Legacy cached user data must never be used as authorization state.
      localStorage.removeItem('user');
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
  }
}
