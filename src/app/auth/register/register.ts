import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { ApiProblem, FastApiValidationError } from '../auth.models';
import { AuthService } from '../../core/services/auth.service';
import { RegisterHero } from './register-hero';

type RegisterField = 'name' | 'email' | 'loginId' | 'password' | 'confirmPassword';

function passwordsMatchValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const password = control.get('password')?.value;
    const confirmation = control.get('confirmPassword')?.value;
    return password && confirmation && password !== confirmation
      ? { passwordsMismatch: true }
      : null;
  };
}

function nonWhitespaceValidator(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim().length === 0
    ? { required: true }
    : null;
}

function optionalLoginIdValidator(control: AbstractControl): ValidationErrors | null {
  if (typeof control.value !== 'string' || control.value.trim() === '') return null;
  const loginId = control.value.trim();
  if (loginId.length < 5 || loginId.length > 50) return { loginIdLength: true };
  return /^[A-Za-z0-9._-]+$/.test(loginId) ? null : { loginIdFormat: true };
}

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink, RegisterHero],
  templateUrl: './register.html',
  styleUrl: './register.css',
})
export class Register {
  private readonly authService = inject(AuthService);
  private readonly formElement = viewChild<ElementRef<HTMLFormElement>>('registerForm');

  protected readonly submitting = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);
  protected readonly success = signal(false);
  protected readonly registeredEmail = signal('');
  protected readonly submissionError = signal('');
  protected readonly backendErrors = signal<Partial<Record<RegisterField, string[]>>>({});

  protected readonly form = new FormGroup(
    {
      name: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, nonWhitespaceValidator, Validators.maxLength(120)],
      }),
      email: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.email, Validators.maxLength(256)],
      }),
      loginId: new FormControl('', {
        nonNullable: true,
        validators: [optionalLoginIdValidator],
      }),
      password: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(8), Validators.maxLength(128)],
      }),
      confirmPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(128)],
      }),
    },
    { validators: passwordsMatchValidator() },
  );

  protected submit(): void {
    this.clearResponseState();

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusFirstInvalidField();
      return;
    }

    this.submitting.set(true);
    const value = this.form.getRawValue();
    const email = value.email.trim();
    const loginId = value.loginId.trim().toLowerCase();
    this.authService
      .register({
        name: value.name.trim(),
        email,
        ...(loginId ? { login_id: loginId } : {}),
        password: value.password,
        confirm_password: value.confirmPassword,
      })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => {
          this.registeredEmail.set(email);
          this.success.set(true);
          this.form.reset();
        },
        error: (error: HttpErrorResponse) => this.handleRegistrationError(error),
      });
  }

  protected clearBackendError(field: RegisterField): void {
    if (!this.backendErrors()[field]) return;
    const errors = { ...this.backendErrors() };
    delete errors[field];
    this.backendErrors.set(errors);
  }

  protected hasError(field: RegisterField): boolean {
    const control = this.form.controls[field];
    const mismatch = field === 'confirmPassword' && this.form.hasError('passwordsMismatch');
    return (
      ((control.invalid || mismatch) && (control.touched || control.dirty)) ||
      !!this.backendErrors()[field]?.length
    );
  }

  protected fieldError(field: RegisterField): string {
    const backendError = this.backendErrors()[field]?.[0];
    if (backendError) return backendError;

    const control = this.form.controls[field];
    if (control.hasError('required')) return `${this.fieldLabel(field)} is required.`;
    if (control.hasError('email')) return 'Enter a valid email address.';
    if (control.hasError('loginIdLength')) return 'User ID must be between 5 and 50 characters.';
    if (control.hasError('loginIdFormat')) {
      return 'Use only letters, numbers, dots, underscores, or hyphens.';
    }
    if (control.hasError('minlength')) return 'Password must be at least 8 characters.';
    if (control.hasError('maxlength')) return `${this.fieldLabel(field)} is too long.`;
    if (field === 'confirmPassword' && this.form.hasError('passwordsMismatch')) {
      return 'Passwords must match.';
    }
    return '';
  }

  private fieldLabel(field: RegisterField): string {
    return field === 'confirmPassword'
      ? 'Confirm password'
      : field.charAt(0).toUpperCase() + field.slice(1);
  }

  private clearResponseState(): void {
    this.success.set(false);
    this.registeredEmail.set('');
    this.submissionError.set('');
    this.backendErrors.set({});
  }

  private handleRegistrationError(error: HttpErrorResponse): void {
    const problem = this.asProblem(error.error);

    if (error.status === 400) {
      this.submissionError.set(this.problemMessage(problem) ?? 'Email already registered');
      return;
    }

    if (error.status === 422) {
      this.applyValidationErrors(problem);
      this.focusFirstInvalidField();
      return;
    }

    if (error.status === 0) {
      this.submissionError.set('Network error. Please check your connection and try again.');
      return;
    }

    if (error.status >= 500) {
      this.submissionError.set('Server error. Please try again later.');
      return;
    }

    this.submissionError.set(
      this.problemMessage(problem) ?? 'Registration failed. Please try again.',
    );
  }

  private asProblem(value: unknown): ApiProblem {
    return value && typeof value === 'object' ? (value as ApiProblem) : {};
  }

  private applyValidationErrors(problem: ApiProblem): void {
    const fieldErrors: Partial<Record<RegisterField, string[]>> = {};

    if (Array.isArray(problem.detail)) {
      for (const issue of problem.detail) {
        const field = this.toRegisterField(issue);
        if (!field || !issue.msg) continue;
        fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.msg];
      }
    }

    if (Array.isArray(problem.errors)) {
      for (const issue of problem.errors) {
        const field = this.toRegisterField({ loc: [issue.field ?? ''] });
        if (!field || !issue.message) continue;
        fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message];
      }
    } else if (problem.errors) {
      for (const [backendField, value] of Object.entries(problem.errors)) {
        const field = this.toRegisterField({ loc: [backendField] });
        if (!field) continue;
        const messages = Array.isArray(value) ? value : [value];
        fieldErrors[field] = [...(fieldErrors[field] ?? []), ...messages];
      }
    }

    this.backendErrors.set(fieldErrors);
    if (Object.keys(fieldErrors).length === 0) {
      this.submissionError.set(
        this.problemMessage(problem) ?? 'Please check your details and try again.',
      );
    }
  }

  private toRegisterField(issue: FastApiValidationError): RegisterField | null {
    const field = issue.loc?.at(-1);
    if (field === 'confirm_password' || field === 'confirmPassword') return 'confirmPassword';
    if (field === 'login_id' || field === 'loginId') return 'loginId';
    return field === 'name' || field === 'email' || field === 'password' ? field : null;
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
