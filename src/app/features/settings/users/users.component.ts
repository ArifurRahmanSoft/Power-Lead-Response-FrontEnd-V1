import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { debounceTime, distinctUntilChanged, finalize, forkJoin } from 'rxjs';
import { Router } from '@angular/router';

import { PERMISSIONS } from '../../../core/models/auth.models';
import { SettingsRole, SettingsUser } from '../../../core/models/settings.models';
import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { settingsErrorMessage } from '../settings-errors';

function matchingPasswords(passwordField: string, confirmationField: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const password = control.get(passwordField)?.value;
    const confirmation = control.get(confirmationField)?.value;
    return password !== confirmation ? { passwordsMismatch: true } : null;
  };
}

function bcryptByteLength(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && new TextEncoder().encode(control.value).length > 72
    ? { bcryptLength: true }
    : null;
}

function trimmedRequired(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim().length === 0
    ? { required: true }
    : null;
}

function loginIdPolicy(control: AbstractControl): ValidationErrors | null {
  if (typeof control.value !== 'string') return null;
  const value = control.value.trim();
  if (value.length < 5 || value.length > 50) return { loginIdLength: true };
  return /^[A-Za-z0-9._-]+$/.test(value) ? null : { pattern: true };
}

@Component({
  selector: 'app-settings-users',
  imports: [ReactiveFormsModule],
  templateUrl: './users.component.html',
  styleUrls: ['../settings.shared.css', './users.component.css'],
})
export class UsersComponent {
  private readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly permissions = PERMISSIONS;

  protected readonly users = signal<SettingsUser[]>([]);
  protected readonly roles = signal<SettingsRole[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly successMessage = signal('');
  protected readonly page = signal(1);
  protected readonly pageSize = 10;
  protected readonly total = signal(0);
  protected readonly searchTerm = signal('');
  protected readonly modalMode = signal<'create' | 'edit' | 'reset' | null>(null);
  protected readonly selectedUser = signal<SettingsUser | null>(null);
  protected readonly revokeCandidate = signal<SettingsUser | null>(null);
  protected readonly searchControl = new FormControl('', { nonNullable: true });

  protected readonly createForm = new FormGroup(
    {
      displayName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, trimmedRequired, Validators.maxLength(120)],
      }),
      email: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.email],
      }),
      loginId: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, loginIdPolicy],
      }),
      password: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(128), bcryptByteLength],
      }),
      confirmPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(128), bcryptByteLength],
      }),
      roleId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: matchingPasswords('password', 'confirmPassword') },
  );

  protected readonly editForm = new FormGroup({
    displayName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, trimmedRequired, Validators.maxLength(120)],
    }),
    roleId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected readonly resetForm = new FormGroup(
    {
      password: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(128), bcryptByteLength],
      }),
      confirmPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(128), bcryptByteLength],
      }),
    },
    { validators: matchingPasswords('password', 'confirmPassword') },
  );

  protected readonly filteredUsers = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    return query
      ? this.users().filter((user) =>
          [user.display_name, user.login_id, user.role_name, user.email].some((value) =>
            value.toLowerCase().includes(query),
          ),
        )
      : this.users();
  });
  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize)),
  );
  protected readonly rolesAvailable = computed(() => this.roles().length > 0);

  constructor() {
    this.searchControl.valueChanges
      .pipe(debounceTime(150), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.searchTerm.set(value));
    this.loadInitialData();
  }

  protected loadUsers(page = this.page()): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.settings
      .listUsers(page, this.pageSize)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.users.set(data.items);
          this.page.set(data.page);
          this.total.set(data.total);
        },
        error: (error) =>
          this.errorMessage.set(settingsErrorMessage(error, 'Unable to load workspace users.')),
      });
  }

  protected openCreate(): void {
    this.selectedUser.set(null);
    this.createForm.reset();
    this.modalMode.set('create');
    this.clearMessages();
  }

  protected openEdit(user: SettingsUser): void {
    this.selectedUser.set(user);
    this.editForm.setValue({ displayName: user.display_name, roleId: user.role_id });
    this.modalMode.set('edit');
    this.clearMessages();
  }

  protected openReset(user: SettingsUser): void {
    this.selectedUser.set(user);
    this.resetForm.reset();
    this.modalMode.set('reset');
    this.clearMessages();
  }

  protected closeModal(): void {
    if (this.saving()) return;
    this.resetModalState();
  }

  private resetModalState(): void {
    this.modalMode.set(null);
    this.selectedUser.set(null);
    this.createForm.reset();
    this.editForm.reset();
    this.resetForm.reset();
  }

  protected createUser(): void {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    const value = this.createForm.getRawValue();
    this.runMutation(
      this.settings.createUser({
        display_name: value.displayName.trim().replace(/\s+/g, ' '),
        email: value.email.trim().toLowerCase(),
        login_id: value.loginId.trim().toLowerCase(),
        password: value.password,
        confirm_password: value.confirmPassword,
        role_id: value.roleId,
      }),
      'Unable to create the workspace user.',
    );
  }

  protected updateUser(): void {
    const user = this.selectedUser();
    if (!user || this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }
    const value = this.editForm.getRawValue();
    this.runMutation(
      this.settings.updateUser(user.id, {
        display_name: value.displayName.trim().replace(/\s+/g, ' '),
        role_id: value.roleId,
      }),
      'Unable to update the workspace user.',
    );
  }

  protected resetPassword(): void {
    const user = this.selectedUser();
    if (!user || this.resetForm.invalid) {
      this.resetForm.markAllAsTouched();
      return;
    }
    const value = this.resetForm.getRawValue();
    this.saving.set(true);
    this.settings
      .resetUserPassword(user.id, {
        password: value.password,
        confirm_password: value.confirmPassword,
      })
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ message }) => {
          this.successMessage.set(message);
          this.resetModalState();
        },
        error: (error) =>
          this.errorMessage.set(settingsErrorMessage(error, 'Unable to reset the password.')),
      });
  }

  protected revokeUser(): void {
    const user = this.revokeCandidate();
    if (!user) return;
    this.saving.set(true);
    this.settings
      .revokeUser(user.id)
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ message }) => {
          this.successMessage.set(message);
          this.revokeCandidate.set(null);
          if (user.id === this.auth.user()?.id) {
            this.auth
              .refreshCurrentSession()
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe((authenticated) => {
                if (!authenticated) void this.router.navigate(['/login']);
              });
          } else {
            this.loadUsers();
          }
        },
        error: (error) => {
          this.revokeCandidate.set(null);
          this.errorMessage.set(settingsErrorMessage(error, 'Unable to revoke workspace access.'));
        },
      });
  }

  protected fieldError(form: 'create' | 'edit' | 'reset', field: string): string {
    const group: AbstractControl =
      form === 'create' ? this.createForm : form === 'edit' ? this.editForm : this.resetForm;
    const control = group.get(field);
    if (!control || !(control.touched || control.dirty)) return '';
    const label: Record<string, string> = {
      displayName: 'User name',
      email: 'Email',
      loginId: 'User ID',
      password: 'Password',
      confirmPassword: 'Confirm password',
      roleId: 'Role',
    };
    if (control.hasError('required')) return `${label[field]} is required.`;
    if (control.hasError('email')) return 'Enter a valid email address.';
    if (control.hasError('loginIdLength')) return 'User ID must be between 5 and 50 characters.';
    if (control.hasError('maxlength')) return `${label[field]} is too long.`;
    if (control.hasError('pattern'))
      return 'Use only letters, numbers, dots, underscores, or hyphens.';
    if (control.hasError('bcryptLength')) return 'Password must be 72 UTF-8 bytes or fewer.';
    return '';
  }

  protected passwordMismatch(form: 'create' | 'reset'): boolean {
    const group = form === 'create' ? this.createForm : this.resetForm;
    return group.hasError('passwordsMismatch') && group.controls.confirmPassword.touched;
  }

  private loadInitialData(): void {
    this.loading.set(true);
    const users = this.settings.listUsers(1, this.pageSize);
    if (!this.auth.hasPermission(PERMISSIONS.settingsRolesView)) {
      users
        .pipe(
          finalize(() => this.loading.set(false)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe({
          next: ({ data }) => this.acceptUsers(data),
          error: (error) =>
            this.errorMessage.set(settingsErrorMessage(error, 'Unable to load users.')),
        });
      return;
    }
    forkJoin({ users, roles: this.settings.listRoles(1, 100) })
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ users: userResponse, roles }) => {
          this.acceptUsers(userResponse.data);
          this.roles.set(roles.data.items);
        },
        error: (error) =>
          this.errorMessage.set(settingsErrorMessage(error, 'Unable to load user setup.')),
      });
  }

  private acceptUsers(data: { items: SettingsUser[]; page: number; total: number }): void {
    this.users.set(data.items);
    this.page.set(data.page);
    this.total.set(data.total);
  }

  private runMutation(
    operation: ReturnType<SettingsService['createUser']>,
    fallback: string,
  ): void {
    this.saving.set(true);
    this.errorMessage.set('');
    operation
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ message }) => {
          this.successMessage.set(message);
          this.resetModalState();
          this.loadUsers();
        },
        error: (error: HttpErrorResponse) =>
          this.errorMessage.set(settingsErrorMessage(error, fallback)),
      });
  }

  private clearMessages(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
  }
}
