import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Observable, finalize } from 'rxjs';

import { PERMISSIONS } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import {
  SenderAccount,
  SenderAccountCreateRequest,
  SenderAccountUpdateRequest,
  SenderEncryption,
  SenderProvider,
} from '../models/sender-account.models';
import { senderAccountErrorMessage } from '../sender-account-errors';
import { SenderAccountsService } from '../services/sender-accounts.service';

type EditorMode = 'create' | 'edit' | null;
type ConfirmAction = 'deactivate' | 'delete' | null;

function optionalEmail(control: AbstractControl): ValidationErrors | null {
  const value = typeof control.value === 'string' ? control.value.trim() : '';
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : { email: true };
}

@Component({
  selector: 'app-sender-accounts',
  imports: [DatePipe, ReactiveFormsModule],
  templateUrl: './sender-accounts.component.html',
  styleUrl: './sender-accounts.component.css',
})
export class SenderAccountsComponent implements OnInit {
  private readonly service = inject(SenderAccountsService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  protected readonly permissions = PERMISSIONS;

  protected readonly accounts = signal<SenderAccount[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly busyAccountId = signal<string | null>(null);
  protected readonly errorMessage = signal('');
  protected readonly successMessage = signal('');
  protected readonly page = signal(1);
  protected readonly pageSize = 20;
  protected readonly total = signal(0);
  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize)),
  );

  protected readonly editorMode = signal<EditorMode>(null);
  protected readonly selectedAccount = signal<SenderAccount | null>(null);
  protected readonly replaceCredential = signal(false);
  protected readonly showCredential = signal(false);
  protected readonly confirmAction = signal<ConfirmAction>(null);
  protected readonly confirmCandidate = signal<SenderAccount | null>(null);
  protected readonly testEmailCandidate = signal<SenderAccount | null>(null);

  protected readonly accountForm = new FormGroup({
    displayName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    senderEmail: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    provider: new FormControl<SenderProvider>('gmail', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    smtpHost: new FormControl('smtp.gmail.com', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(255)],
    }),
    smtpPort: new FormControl<number>(587, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1), Validators.max(65535)],
    }),
    encryption: new FormControl<SenderEncryption>('STARTTLS', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    smtpUsername: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(255)],
    }),
    credential: new FormControl('', { nonNullable: true }),
    replyTo: new FormControl('', {
      nonNullable: true,
      validators: [optionalEmail],
    }),
    isDefault: new FormControl(false, { nonNullable: true }),
  });

  protected readonly testEmailForm = new FormGroup({
    recipient: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    confirmed: new FormControl(false, {
      nonNullable: true,
      validators: [Validators.requiredTrue],
    }),
  });

  constructor() {
    this.accountForm.controls.provider.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((provider) => this.applyProviderDefaults(provider));
    this.accountForm.controls.encryption.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((encryption) => {
        if (this.accountForm.controls.provider.value === 'gmail') {
          this.accountForm.controls.smtpPort.setValue(encryption === 'TLS' ? 465 : 587);
        }
      });
  }

  ngOnInit(): void {
    this.loadAccounts();
  }

  protected loadAccounts(page = this.page()): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.service
      .list(page, this.pageSize, true)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.accounts.set(data.items);
          this.page.set(data.page);
          this.total.set(data.total);
        },
        error: (error) =>
          this.errorMessage.set(
            senderAccountErrorMessage(error, 'Unable to load sender accounts.'),
          ),
      });
  }

  protected openCreate(): void {
    this.clearMessages();
    this.editorMode.set('create');
    this.selectedAccount.set(null);
    this.replaceCredential.set(false);
    this.showCredential.set(false);
    this.resetCreateForm();
  }

  protected openEdit(account: SenderAccount): void {
    this.clearMessages();
    this.editorMode.set('edit');
    this.selectedAccount.set(account);
    this.replaceCredential.set(false);
    this.showCredential.set(false);
    this.accountForm.reset({
      displayName: account.display_name,
      senderEmail: account.sender_email,
      provider: account.provider,
      smtpHost: account.smtp_host,
      smtpPort: account.smtp_port,
      encryption: account.encryption,
      smtpUsername: account.smtp_username,
      credential: '',
      replyTo: account.reply_to ?? '',
      isDefault: account.is_default,
    });
    this.configureCredentialValidation();
  }

  protected closeEditor(): void {
    if (this.saving()) return;
    this.editorMode.set(null);
    this.selectedAccount.set(null);
    this.accountForm.controls.credential.setValue('');
    this.showCredential.set(false);
  }

  protected chooseCredentialReplacement(): void {
    this.replaceCredential.set(true);
    this.configureCredentialValidation();
  }

  protected cancelCredentialReplacement(): void {
    this.replaceCredential.set(false);
    this.showCredential.set(false);
    this.accountForm.controls.credential.setValue('');
    this.configureCredentialValidation();
  }

  protected syncGmailUsername(): void {
    if (
      this.accountForm.controls.provider.value === 'gmail' &&
      !this.accountForm.controls.smtpUsername.value.trim()
    ) {
      this.accountForm.controls.smtpUsername.setValue(
        this.accountForm.controls.senderEmail.value.trim().toLowerCase(),
      );
    }
  }

  protected save(addAnother = false): void {
    this.configureCredentialValidation();
    this.syncGmailUsername();
    if (this.accountForm.invalid) {
      this.accountForm.markAllAsTouched();
      return;
    }

    const request = this.buildRequest();
    const mode = this.editorMode();
    const selected = this.selectedAccount();
    if (!mode || (mode === 'edit' && !selected)) return;

    this.saving.set(true);
    this.clearMessages();
    const operation =
      mode === 'create'
        ? this.service.create(request as SenderAccountCreateRequest)
        : this.service.update(selected!.id, request);

    operation
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ message }) => {
          this.successMessage.set(
            message || (mode === 'create' ? 'Sender account created.' : 'Sender account updated.'),
          );
          this.loadAccounts(mode === 'create' ? 1 : this.page());
          if (mode === 'create' && addAnother) {
            this.resetCreateForm();
          } else {
            this.editorMode.set(null);
            this.selectedAccount.set(null);
          }
        },
        error: (error) =>
          this.errorMessage.set(
            senderAccountErrorMessage(
              error,
              mode === 'create'
                ? 'Unable to create the sender account.'
                : 'Unable to update the sender account.',
            ),
          ),
      });
  }

  protected requestConfirmation(
    action: Exclude<ConfirmAction, null>,
    account: SenderAccount,
  ): void {
    this.confirmAction.set(action);
    this.confirmCandidate.set(account);
  }

  protected closeConfirmation(): void {
    if (this.busyAccountId()) return;
    this.confirmAction.set(null);
    this.confirmCandidate.set(null);
  }

  protected confirmAccountAction(): void {
    const account = this.confirmCandidate();
    const action = this.confirmAction();
    if (!account || !action) return;
    const operation =
      action === 'deactivate'
        ? this.service.deactivate(account.id)
        : this.service.delete(account.id);
    this.runAccountAction(account.id, operation, `Unable to ${action} the sender account.`, () => {
      this.closeConfirmation();
      this.loadAccounts();
    });
  }

  protected setDefault(account: SenderAccount): void {
    this.runAccountAction(
      account.id,
      this.service.setDefault(account.id),
      'Unable to set the default sender account.',
      () => this.loadAccounts(),
    );
  }

  protected testConnection(account: SenderAccount): void {
    this.busyAccountId.set(account.id);
    this.clearMessages();
    this.service
      .testConnection(account.id)
      .pipe(
        finalize(() => this.busyAccountId.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response) => {
          this.accounts.update((accounts) =>
            accounts.map((item) =>
              item.id === account.id
                ? {
                    ...item,
                    connection_status: response.data.connection_status,
                    last_tested_at: response.data.last_tested_at,
                    last_test_message: response.message,
                  }
                : item,
            ),
          );
          if (response.success) this.successMessage.set(response.message);
          else this.errorMessage.set(response.message || 'Connection test failed.');
        },
        error: (error) =>
          this.errorMessage.set(
            senderAccountErrorMessage(error, 'Unable to test the SMTP connection.'),
          ),
      });
  }

  protected openTestEmail(account: SenderAccount): void {
    this.clearMessages();
    this.testEmailCandidate.set(account);
    this.testEmailForm.reset({ recipient: '', confirmed: false });
  }

  protected closeTestEmail(): void {
    if (this.busyAccountId()) return;
    this.testEmailCandidate.set(null);
    this.testEmailForm.reset({ recipient: '', confirmed: false });
  }

  protected sendTestEmail(): void {
    const account = this.testEmailCandidate();
    if (!account) return;
    if (this.testEmailForm.invalid) {
      this.testEmailForm.markAllAsTouched();
      return;
    }
    const recipient = this.testEmailForm.controls.recipient.value.trim().toLowerCase();
    this.runAccountAction(
      account.id,
      this.service.sendTestEmail(account.id, recipient),
      'Unable to send the test email.',
      () => this.closeTestEmail(),
    );
  }

  protected providerLabel(provider: SenderProvider): string {
    return provider === 'gmail' ? 'Gmail' : 'Business email';
  }

  protected connectionLabel(account: SenderAccount): string {
    if (account.connection_status === 'success') return 'Connected';
    if (account.connection_status === 'failed') return 'Failed';
    return 'Not tested';
  }

  protected fieldError(controlName: keyof typeof this.accountForm.controls): string {
    const control = this.accountForm.controls[controlName];
    if (!control.invalid || (!control.touched && !control.dirty)) return '';
    if (control.hasError('required')) return 'This field is required.';
    if (control.hasError('email')) return 'Enter a valid email address.';
    if (control.hasError('min') || control.hasError('max')) return 'Enter a port from 1 to 65535.';
    if (control.hasError('maxlength')) return 'This value is too long.';
    return 'Check this value.';
  }

  protected testEmailError(controlName: 'recipient' | 'confirmed'): string {
    const control = this.testEmailForm.controls[controlName];
    if (!control.invalid || (!control.touched && !control.dirty)) return '';
    return controlName === 'recipient'
      ? 'Enter a valid recipient email address.'
      : 'Confirm that you want to send this test email.';
  }

  private applyProviderDefaults(provider: SenderProvider): void {
    if (provider !== 'gmail') return;
    const encryption = this.accountForm.controls.encryption.value;
    this.accountForm.patchValue(
      {
        smtpHost: 'smtp.gmail.com',
        smtpPort: encryption === 'TLS' ? 465 : 587,
        smtpUsername:
          this.accountForm.controls.smtpUsername.value.trim() ||
          this.accountForm.controls.senderEmail.value.trim().toLowerCase(),
      },
      { emitEvent: false },
    );
  }

  private configureCredentialValidation(): void {
    const required = this.editorMode() === 'create' || this.replaceCredential();
    this.accountForm.controls.credential.setValidators(required ? [Validators.required] : []);
    this.accountForm.controls.credential.updateValueAndValidity({ emitEvent: false });
  }

  private buildRequest(): SenderAccountCreateRequest | SenderAccountUpdateRequest {
    const value = this.accountForm.getRawValue();
    const gmail = value.provider === 'gmail';
    const base: SenderAccountUpdateRequest = {
      display_name: value.displayName.trim(),
      sender_email: value.senderEmail.trim().toLowerCase(),
      provider: value.provider,
      authentication_type: gmail ? 'app_password' : 'password',
      smtp_host: gmail ? 'smtp.gmail.com' : value.smtpHost.trim(),
      smtp_port: value.smtpPort,
      encryption: value.encryption,
      smtp_username: value.smtpUsername.trim(),
      reply_to: value.replyTo.trim().toLowerCase() || null,
    };
    if (this.editorMode() === 'create') {
      return {
        ...base,
        credential: value.credential,
        is_active: true,
        is_default: value.isDefault,
      } as SenderAccountCreateRequest;
    }
    if (this.replaceCredential()) base.credential = value.credential;
    return base;
  }

  private resetCreateForm(): void {
    this.accountForm.reset({
      displayName: '',
      senderEmail: '',
      provider: 'gmail',
      smtpHost: 'smtp.gmail.com',
      smtpPort: 587,
      encryption: 'STARTTLS',
      smtpUsername: '',
      credential: '',
      replyTo: '',
      isDefault: false,
    });
    this.replaceCredential.set(false);
    this.showCredential.set(false);
    this.configureCredentialValidation();
  }

  private runAccountAction(
    accountId: string,
    operation: Observable<{ success: boolean; message?: string }>,
    fallback: string,
    onSuccess: () => void,
  ): void {
    this.busyAccountId.set(accountId);
    this.clearMessages();
    operation
      .pipe(
        finalize(() => this.busyAccountId.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ message }) => {
          this.successMessage.set(message || 'Sender account updated.');
          this.busyAccountId.set(null);
          onSuccess();
        },
        error: (error) => this.errorMessage.set(senderAccountErrorMessage(error, fallback)),
      });
  }

  private clearMessages(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
  }
}
