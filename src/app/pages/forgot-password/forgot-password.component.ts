import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { ApiFieldError, ApiProblem } from '../../auth/auth.models';
import { RegisterHero } from '../../auth/register/register-hero';
import { AuthService } from '../../core/services/auth.service';

const GENERIC_SUCCESS_MESSAGE = 'If the email exists, a password reset link has been sent.';

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink, RegisterHero],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss',
})
export class ForgotPasswordComponent {
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formElement = viewChild<ElementRef<HTMLFormElement>>('forgotPasswordForm');

  protected readonly submitting = signal(false);
  protected readonly success = signal(false);
  protected readonly submissionError = signal('');
  protected readonly backendEmailError = signal('');
  protected readonly successMessage = GENERIC_SUCCESS_MESSAGE;

  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
  });

  protected submit(): void {
    this.success.set(false);
    this.submissionError.set('');
    this.backendEmailError.set('');

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusEmail();
      return;
    }

    this.submitting.set(true);
    this.authService
      .forgotPassword(this.form.controls.email.getRawValue().trim())
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: () => {
          this.success.set(true);
          this.form.reset();
        },
        error: (error: HttpErrorResponse) => this.handleError(error),
      });
  }

  protected hasEmailError(): boolean {
    const email = this.form.controls.email;
    return (email.invalid && (email.touched || email.dirty)) || !!this.backendEmailError();
  }

  protected emailError(): string {
    if (this.backendEmailError()) return this.backendEmailError();
    const email = this.form.controls.email;
    if (email.hasError('required')) return 'Email is required.';
    if (email.hasError('email')) return 'Enter a valid email address.';
    return '';
  }

  protected clearEmailError(): void {
    this.backendEmailError.set('');
  }

  private handleError(error: HttpErrorResponse): void {
    const problem = this.asProblem(error.error);

    if (error.status === 400) {
      this.submissionError.set('We could not process your request. Please try again.');
      return;
    }

    if (error.status === 422) {
      const issue = this.validationIssues(problem).find((item) => item.field === 'email');
      if (issue?.message) {
        this.backendEmailError.set(issue.message);
        this.focusEmail();
      } else {
        this.submissionError.set('Enter a valid email address and try again.');
      }
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

    this.submissionError.set('Unable to send the reset link. Please try again.');
  }

  private validationIssues(problem: ApiProblem): ApiFieldError[] {
    if (Array.isArray(problem.errors)) return problem.errors;

    if (Array.isArray(problem.detail)) {
      return problem.detail.map((issue) => ({
        field: String(issue.loc?.at(-1) ?? ''),
        message: issue.msg,
      }));
    }

    return [];
  }

  private asProblem(value: unknown): ApiProblem {
    return value && typeof value === 'object' ? (value as ApiProblem) : {};
  }

  private focusEmail(): void {
    queueMicrotask(() => {
      this.formElement()?.nativeElement.querySelector<HTMLElement>('#forgot-email')?.focus();
    });
  }
}
