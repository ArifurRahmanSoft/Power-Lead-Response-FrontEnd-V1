import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { debounceTime, distinctUntilChanged, finalize } from 'rxjs';

import { PERMISSIONS } from '../../../core/models/auth.models';
import { SettingsRole } from '../../../core/models/settings.models';
import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { settingsErrorMessage } from '../settings-errors';

function trimmedRoleName(control: AbstractControl): ValidationErrors | null {
  const length = typeof control.value === 'string' ? control.value.trim().length : 0;
  return length < 2 ? { trimmedMinlength: true } : null;
}

@Component({
  selector: 'app-settings-roles',
  imports: [ReactiveFormsModule],
  templateUrl: './roles.component.html',
  styleUrls: ['../settings.shared.css', './roles.component.css'],
})
export class RolesComponent {
  private readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  protected readonly permissions = PERMISSIONS;

  protected readonly roles = signal<SettingsRole[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly successMessage = signal('');
  protected readonly page = signal(1);
  protected readonly pageSize = 10;
  protected readonly total = signal(0);
  protected readonly searchTerm = signal('');
  protected readonly modalMode = signal<'create' | 'edit' | null>(null);
  protected readonly selectedRole = signal<SettingsRole | null>(null);
  protected readonly deleteCandidate = signal<SettingsRole | null>(null);
  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly roleForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, trimmedRoleName, Validators.maxLength(100)],
    }),
  });

  protected readonly filteredRoles = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    return query
      ? this.roles().filter(
          (role) => role.name.toLowerCase().includes(query) || role.key.includes(query),
        )
      : this.roles();
  });
  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize)),
  );

  constructor() {
    this.searchControl.valueChanges
      .pipe(debounceTime(150), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.searchTerm.set(value));
    this.loadRoles();
  }

  protected loadRoles(page = this.page()): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.settings
      .listRoles(page, this.pageSize)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.roles.set(data.items);
          this.page.set(data.page);
          this.total.set(data.total);
        },
        error: (error) =>
          this.errorMessage.set(settingsErrorMessage(error, 'Unable to load roles.')),
      });
  }

  protected openCreate(): void {
    this.selectedRole.set(null);
    this.roleForm.reset();
    this.modalMode.set('create');
    this.clearMessages();
  }

  protected openEdit(role: SettingsRole): void {
    this.selectedRole.set(role);
    this.roleForm.setValue({ name: role.name });
    this.modalMode.set('edit');
    this.clearMessages();
  }

  protected closeModal(): void {
    if (this.saving()) return;
    this.modalMode.set(null);
    this.roleForm.reset();
  }

  protected saveRole(): void {
    if (this.roleForm.invalid) {
      this.roleForm.markAllAsTouched();
      return;
    }
    const request = { name: this.roleForm.controls.name.value.trim().replace(/\s+/g, ' ') };
    const selected = this.selectedRole();
    const operation = selected
      ? this.settings.updateRole(selected.id, request)
      : this.settings.createRole(request);
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
          this.modalMode.set(null);
          this.loadRoles();
        },
        error: (error: HttpErrorResponse) =>
          this.errorMessage.set(settingsErrorMessage(error, 'Unable to save the role.')),
      });
  }

  protected confirmDelete(role: SettingsRole): void {
    this.deleteCandidate.set(role);
    this.clearMessages();
  }

  protected deleteRole(): void {
    const role = this.deleteCandidate();
    if (!role) return;
    this.saving.set(true);
    this.settings
      .deleteRole(role.id)
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ message }) => {
          this.successMessage.set(message);
          this.deleteCandidate.set(null);
          this.loadRoles();
        },
        error: (error) => {
          this.deleteCandidate.set(null);
          this.errorMessage.set(
            settingsErrorMessage(error, 'Unable to delete the role. It may be assigned to users.'),
          );
        },
      });
  }

  protected roleNameError(): string {
    const control = this.roleForm.controls.name;
    if (!(control.touched || control.dirty)) return '';
    if (control.hasError('required')) return 'Role name is required.';
    if (control.hasError('trimmedMinlength')) return 'Role name must be at least 2 characters.';
    if (control.hasError('maxlength')) return 'Role name must be 100 characters or fewer.';
    return '';
  }

  private clearMessages(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
  }
}
