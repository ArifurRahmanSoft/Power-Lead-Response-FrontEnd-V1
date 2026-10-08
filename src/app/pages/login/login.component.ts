import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { ApiProblem } from '../../auth/auth.models';
import { AuthService } from '../../core/services/auth.service';
import { safeInternalReturnUrl } from '../../core/utils/return-url';
import { RegisterHero } from '../../auth/register/register-hero';

type LoginField = 'identifier' | 'password';
type ValidationIssue = { field?: string; message?: string };

function trimmedMinLength(minLength: number) {
  return (control: AbstractControl): ValidationErrors | null =>
    typeof control.value === 'string' && control.value.trim().length < minLength
      ? { trimmedMinlength: { requiredLength: minLength } }
      : null;
}

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, RegisterHero],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formElement = viewChild<ElementRef<HTMLFormElement>>('loginForm');

  protected readonly submitting = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly submissionError = signal('');
  protected readonly backendErrors = signal<Partial<Record<LoginField, string>>>({});
  protected readonly signedIn = signal(false);

  protected readonly form = new FormGroup({
    identifier: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, trimmedMinLength(5)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  protected submit(): void {
    this.submissionError.set('');
    this.backendErrors.set({});
    this.signedIn.set(false);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusFirstInvalidField();
      return;
    }

    this.submitting.set(true);
    const credentials = this.form.getRawValue();

    this.authService
      .login({ identifier: credentials.identifier.trim(), password: credentials.password })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => {
          const returnUrl = safeInternalReturnUrl(
            this.route.snapshot.queryParamMap.get('returnUrl'),
          );
          if (this.authService.authStatus() === 'workspace_selection_required') {
            void this.router.navigate(['/select-workspace'], {
              queryParams: returnUrl ? { returnUrl } : undefined,
            });
            return;
          }
          if (this.authService.authStatus() === 'onboarding_pending') {
            void this.router.navigate(['/onboarding-pending']);
            return;
          }
          if (returnUrl) {
            void this.router.navigateByUrl(returnUrl);
            return;
          }
          void this.router.navigate(['/overview']);
        },
        error: (error: HttpErrorResponse) => this.handleLoginError(error),
      });
  }

  protected clearBackendError(field: LoginField): void {
    if (!this.backendErrors()[field]) return;
    const errors = { ...this.backendErrors() };
    delete errors[field];
    this.backendErrors.set(errors);
  }

  protected hasError(field: LoginField): boolean {
    const control = this.form.controls[field];
    return (control.invalid && (control.touched || control.dirty)) || !!this.backendErrors()[field];
  }

  protected fieldError(field: LoginField): string {
    const backendError = this.backendErrors()[field];
    if (backendError) return backendError;

    const control = this.form.controls[field];
    if (control.hasError('required')) {
      return `${field === 'identifier' ? 'User ID or email' : 'Password'} is required.`;
    }
    if (control.hasError('trimmedMinlength')) {
      return 'User ID or email must be at least 5 characters.';
    }
    return '';
  }

  private handleLoginError(error: HttpErrorResponse): void {
    const problem = this.asProblem(error.error);

    if (error.status === 401) {
      this.submissionError.set('Invalid user ID, email, or password. Please try again.');
      return;
    }

    if (error.status === 400 || error.status === 422) {
      this.applyValidationErrors(problem);
      this.focusFirstInvalidField();
      return;
    }

    if (error.status === 0) {
      this.submissionError.set('Unable to reach the server. Check your connection and try again.');
      return;
    }

    if (error.status >= 500) {
      this.submissionError.set('The server encountered an error. Please try again later.');
      return;
    }

    this.submissionError.set(this.problemMessage(problem) ?? 'Sign in failed. Please try again.');
  }

  private applyValidationErrors(problem: ApiProblem): void {
    const errors: Partial<Record<LoginField, string>> = {};
    const issues = Array.isArray(problem.errors) ? (problem.errors as ValidationIssue[]) : [];

    for (const issue of issues) {
      const field = issue.field === 'email' ? 'identifier' : issue.field;
      if ((field === 'identifier' || field === 'password') && issue.message) {
        errors[field] = issue.message;
      }
    }

    if (Array.isArray(problem.detail)) {
      for (const issue of problem.detail) {
        const field = issue.loc?.at(-1);
        const loginField = field === 'email' ? 'identifier' : field;
        if ((loginField === 'identifier' || loginField === 'password') && issue.msg) {
          errors[loginField] = issue.msg;
        }
      }
    }

    this.backendErrors.set(errors);
    if (Object.keys(errors).length === 0) {
      this.submissionError.set(
        this.problemMessage(problem) ?? 'Please check your user ID or email and password.',
      );
    }
  }

  private asProblem(value: unknown): ApiProblem {
    return value && typeof value === 'object' ? (value as ApiProblem) : {};
  }

  private problemMessage(problem: ApiProblem): string | null {
    if (typeof problem.detail === 'string') return problem.detail;
    return typeof problem.message === 'string' ? problem.message : null;
  }

  private focusFirstInvalidField(): void {
    queueMicrotask(() => {
      this.formElement()
        ?.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    });
  }
}
