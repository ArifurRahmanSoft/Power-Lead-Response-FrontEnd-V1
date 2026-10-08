import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, timer } from 'rxjs';

import { ApiFieldError, ApiProblem } from '../../auth/auth.models';
import { RegisterHero } from '../../auth/register/register-hero';
import { AuthService } from '../../core/services/auth.service';

type ResetField = 'newPassword' | 'confirmPassword';

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const password = control.get('newPassword')?.value;
  const confirmation = control.get('confirmPassword')?.value;
  return password && confirmation && password !== confirmation ? { passwordsMismatch: true } : null;
}

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink, RegisterHero],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
})
export class ResetPasswordComponent {
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formElement = viewChild<ElementRef<HTMLFormElement>>('resetPasswordForm');
  private readonly token = this.route.snapshot.queryParamMap.get('token')?.trim() ?? '';

  protected readonly submitting = signal(false);
  protected readonly success = signal(false);
  protected readonly submissionError = signal('');
  protected readonly showNewPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);
  protected readonly backendErrors = signal<Partial<Record<ResetField, string>>>({});
  protected readonly missingToken = !this.token;

  protected readonly form = new FormGroup(
    {
      newPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(128)],
      }),
      confirmPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(128)],
      }),
    },
    { validators: passwordsMatch },
  );

  protected submit(): void {
    this.submissionError.set('');
    this.backendErrors.set({});

    if (this.missingToken) {
      this.submissionError.set('This reset link is missing a token. Request a new reset link.');
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusFirstInvalidField();
      return;
    }

    this.submitting.set(true);
    const value = this.form.getRawValue();
    this.authService
      .resetPassword(this.token, value.newPassword, value.confirmPassword)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: () => {
          this.success.set(true);
          this.form.disable();
          timer(1500)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => void this.router.navigate(['/login']));
        },
        error: (error: HttpErrorResponse) => this.handleError(error),
      });
  }

  protected clearBackendError(field: ResetField): void {
    if (!this.backendErrors()[field]) return;
    const errors = { ...this.backendErrors() };
    delete errors[field];
    this.backendErrors.set(errors);
  }

  protected hasError(field: ResetField): boolean {
    const control = this.form.controls[field];
    const mismatch = field === 'confirmPassword' && this.form.hasError('passwordsMismatch');
    return (
      ((control.invalid || mismatch) && (control.touched || control.dirty)) ||
      !!this.backendErrors()[field]
    );
  }

  protected fieldError(field: ResetField): string {
    const backendError = this.backendErrors()[field];
    if (backendError) return backendError;

    const control = this.form.controls[field];
    if (control.hasError('required')) {
      return field === 'newPassword'
        ? 'New password is required.'
        : 'Confirm password is required.';
    }
    if (control.hasError('maxlength')) return 'Password must be 128 characters or fewer.';
    if (field === 'confirmPassword' && this.form.hasError('passwordsMismatch')) {
      return 'Passwords must match.';
    }
    return '';
  }

  private handleError(error: HttpErrorResponse): void {
    const problem = this.asProblem(error.error);

    if (error.status === 400) {
      this.submissionError.set('This password reset link is invalid or has expired.');
      return;
    }

    if (error.status === 422) {
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

    this.submissionError.set('Unable to reset your password. Please try again.');
  }

  private applyValidationErrors(problem: ApiProblem): void {
    const errors: Partial<Record<ResetField, string>> = {};
    for (const issue of this.validationIssues(problem)) {
      const field = this.toResetField(issue.field);
      if (field && issue.message) errors[field] = issue.message;
    }

    this.backendErrors.set(errors);
    if (Object.keys(errors).length === 0) {
      this.submissionError.set('Please check your passwords and try again.');
    }
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

  private toResetField(field: string | undefined): ResetField | null {
    if (field === 'new_password' || field === 'newPassword') return 'newPassword';
    if (field === 'confirm_password' || field === 'confirmPassword') return 'confirmPassword';
    return null;
  }

  private asProblem(value: unknown): ApiProblem {
    return value && typeof value === 'object' ? (value as ApiProblem) : {};
  }

  private focusFirstInvalidField(): void {
    queueMicrotask(() => {
      this.formElement()
        ?.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    });
  }
}
