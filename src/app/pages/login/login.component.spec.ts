import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';

import { LoginRequest, LoginResponse } from '../../core/models/auth.models';
import { AuthService } from '../../core/services/auth.service';
import { LoginComponent } from './login.component';

@Component({ template: '' })
class EmptyRouteComponent {}

class FakeAuthService {
  lastRequest?: LoginRequest;
  authStatus = signal<'workspace_selected' | 'workspace_selection_required' | 'onboarding_pending'>(
    'workspace_selected',
  );

  login(request: LoginRequest): Observable<LoginResponse> {
    this.lastRequest = request;
    return of({
      success: true,
      message: 'Login successful',
      data: {
        access_token: 'token',
        token_type: 'bearer',
        auth_status: this.authStatus(),
        user: {
          id: 'user-id',
          login_id: 'jane.doe',
          name: 'Jane Doe',
          email: 'jane@example.com',
        },
        selected_workspace: { id: 'workspace-id', name: 'Main', slug: 'main' },
        role: 'owner',
        permissions: ['dashboard.read'],
        workspaces: [{ id: 'workspace-id', name: 'Main', slug: 'main', role: 'owner' }],
      },
    });
  }
}

describe('LoginComponent', () => {
  let auth: FakeAuthService;

  beforeEach(async () => {
    auth = new FakeAuthService();
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([{ path: 'overview', component: EmptyRouteComponent }]),
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();
  });

  it('accepts a user ID without applying email validation', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    setInput(fixture.nativeElement, 'identifier', 'jane.doe');
    setInput(fixture.nativeElement, 'password', 'secret');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));

    expect(auth.lastRequest).toEqual({ identifier: 'jane.doe', password: 'secret' });
  });

  it('checks identifier minimum length after trimming', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    setInput(fixture.nativeElement, 'identifier', '  abc  ');
    setInput(fixture.nativeElement, 'password', 'secret');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#identifier-error').textContent).toContain(
      'at least 5 characters',
    );
    expect(auth.lastRequest).toBeUndefined();
  });

  it('trims the identifier but never trims or modifies the password', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    setInput(fixture.nativeElement, 'identifier', '  jane@example.com  ');
    setInput(fixture.nativeElement, 'password', '  exact password  ');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));

    expect(auth.lastRequest).toEqual({
      identifier: 'jane@example.com',
      password: '  exact password  ',
    });
  });
});

function setInput(root: HTMLElement, id: string, value: string): void {
  const input = root.querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
