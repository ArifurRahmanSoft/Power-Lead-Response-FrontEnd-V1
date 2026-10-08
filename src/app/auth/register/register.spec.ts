import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { RegisterRequest, RegisterResponse } from '../auth.models';
import { AuthService } from '../../core/services/auth.service';
import { Register } from './register';

class FakeAuthService {
  response: Observable<RegisterResponse> = of({
    success: true,
    message: 'Registration successful.',
    data: {
      id: 'user-id',
      name: 'Jane Doe',
      email: 'jane@example.com',
      login_id: 'jane.doe',
    },
  });
  lastRequest?: RegisterRequest;

  register(request: RegisterRequest): Observable<RegisterResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

describe('Register', () => {
  let auth: FakeAuthService;

  beforeEach(async () => {
    auth = new FakeAuthService();
    await TestBed.configureTestingModule({
      imports: [Register],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    }).compileComponents();
  });

  it('shows accessible required errors for an empty submission', () => {
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const errors = fixture.nativeElement.querySelectorAll('[role="alert"].field-error');
    expect(errors.length).toBe(4);
    expect(fixture.nativeElement.querySelector('#name-error').textContent).toContain('required');
    expect(auth.lastRequest).toBeUndefined();
  });

  it('rejects mismatched passwords before calling the API', () => {
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();
    setInput(fixture.nativeElement, 'name', 'Jane Doe');
    setInput(fixture.nativeElement, 'email', 'jane@example.com');
    setInput(fixture.nativeElement, 'password', 'StrongPass1!');
    setInput(fixture.nativeElement, 'confirmPassword', 'DifferentPass1!');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#confirm-password-error').textContent).toContain(
      'Passwords must match',
    );
    expect(auth.lastRequest).toBeUndefined();
  });

  it('submits trimmed values and presents the backend success message', () => {
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();
    setInput(fixture.nativeElement, 'name', '  Jane Doe  ');
    setInput(fixture.nativeElement, 'email', '  jane@example.com  ');
    setInput(fixture.nativeElement, 'loginId', '  Jane.Doe  ');
    setInput(fixture.nativeElement, 'password', 'StrongPass1!');
    setInput(fixture.nativeElement, 'confirmPassword', 'StrongPass1!');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(auth.lastRequest?.name).toBe('Jane Doe');
    expect(auth.lastRequest?.email).toBe('jane@example.com');
    expect(auth.lastRequest?.login_id).toBe('jane.doe');
    expect(auth.lastRequest?.confirm_password).toBe('StrongPass1!');
    expect(fixture.nativeElement.querySelector('.success-state h2').textContent).toContain(
      'Registration successful',
    );
    expect(fixture.nativeElement.querySelector('.success-state').textContent).toContain(
      'No workspace has been set up yet.',
    );
  });

  it('validates a supplied login ID against the backend format', () => {
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();
    setInput(fixture.nativeElement, 'name', 'Jane Doe');
    setInput(fixture.nativeElement, 'email', 'jane@example.com');
    setInput(fixture.nativeElement, 'loginId', 'bad id');
    setInput(fixture.nativeElement, 'password', 'StrongPass1!');
    setInput(fixture.nativeElement, 'confirmPassword', 'StrongPass1!');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#login-id-error').textContent).toContain(
      'letters, numbers',
    );
    expect(auth.lastRequest).toBeUndefined();
  });

  it('shows a duplicate-email response from the backend', () => {
    auth.response = throwError(
      () =>
        new HttpErrorResponse({
          status: 400,
          error: {
            detail: 'Email already registered',
          },
        }),
    );
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();
    setInput(fixture.nativeElement, 'name', 'Jane Doe');
    setInput(fixture.nativeElement, 'email', 'jane@example.com');
    setInput(fixture.nativeElement, 'password', 'StrongPass1!');
    setInput(fixture.nativeElement, 'confirmPassword', 'StrongPass1!');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.form-alert').textContent).toContain(
      'Email already registered',
    );
  });

  it('maps FastAPI validation errors to their form fields', () => {
    auth.response = throwError(
      () =>
        new HttpErrorResponse({
          status: 422,
          error: {
            detail: [
              {
                type: 'value_error',
                loc: ['body', 'confirm_password'],
                msg: 'Passwords do not match',
              },
            ],
          },
        }),
    );
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();
    setInput(fixture.nativeElement, 'name', 'Jane Doe');
    setInput(fixture.nativeElement, 'email', 'jane@example.com');
    setInput(fixture.nativeElement, 'password', 'StrongPass1!');
    setInput(fixture.nativeElement, 'confirmPassword', 'StrongPass1!');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#confirm-password-error').textContent).toContain(
      'Passwords do not match',
    );
  });
});

function setInput(root: HTMLElement, id: string, value: string): void {
  const input = root.querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
