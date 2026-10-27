import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { PermissionKey, PERMISSIONS } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import {
  SenderAccount,
  SenderAccountCreateRequest,
  SenderAccountUpdateRequest,
} from '../models/sender-account.models';
import { SenderAccountsService } from '../services/sender-accounts.service';
import { SenderAccountsComponent } from './sender-accounts.component';

const account: SenderAccount = {
  id: 'sender-id',
  display_name: 'Sales Team',
  sender_email: 'sales@example.com',
  provider: 'gmail',
  authentication_type: 'app_password',
  smtp_host: 'smtp.gmail.com',
  smtp_port: 587,
  encryption: 'STARTTLS',
  smtp_username: 'sales@example.com',
  credentials_configured: true,
  reply_to: null,
  is_active: true,
  is_default: false,
  connection_status: 'not_tested',
  last_tested_at: null,
  last_test_message: null,
  created_at: '2026-10-11T00:00:00Z',
  updated_at: '2026-10-11T00:00:00Z',
};

class FakeAuthService {
  readonly permissions = signal<readonly PermissionKey[]>([
    PERMISSIONS.mailView,
    PERMISSIONS.mailManage,
    PERMISSIONS.mailTest,
  ]);
  hasPermission(permission: PermissionKey): boolean {
    return this.permissions().includes(permission);
  }
}

class FakeSenderAccountsService {
  updates: SenderAccountUpdateRequest[] = [];
  creates: SenderAccountCreateRequest[] = [];
  testEmailRecipients: string[] = [];

  list() {
    return of({ success: true, data: { items: [account], page: 1, size: 20, total: 1 } });
  }
  create(request: SenderAccountCreateRequest) {
    this.creates.push(request);
    return of({ success: true, message: 'Sender account created', data: account });
  }
  update(_id: string, request: SenderAccountUpdateRequest) {
    this.updates.push(request);
    return of({ success: true, message: 'Sender account updated', data: account });
  }
  deactivate() {
    return of({ success: true, message: 'Sender account deactivated', data: account });
  }
  delete() {
    return of({ success: true, message: 'Sender account deleted' });
  }
  setDefault() {
    return of({ success: true, message: 'Default sender updated', data: account });
  }
  testConnection() {
    return of({
      success: true,
      message: 'SMTP authentication successful; no email was sent',
      data: {
        sender_account_id: account.id,
        connection_status: 'success' as const,
        last_tested_at: '2026-10-11T01:00:00Z',
      },
    });
  }
  sendTestEmail(_id: string, recipient: string) {
    this.testEmailRecipients.push(recipient);
    return of({ success: true, message: 'Test email sent' });
  }
}

describe('SenderAccountsComponent', () => {
  let fixture: ComponentFixture<SenderAccountsComponent>;
  let service: FakeSenderAccountsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SenderAccountsComponent],
      providers: [
        { provide: AuthService, useClass: FakeAuthService },
        { provide: SenderAccountsService, useClass: FakeSenderAccountsService },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SenderAccountsComponent);
    service = TestBed.inject(SenderAccountsService) as unknown as FakeSenderAccountsService;
    fixture.detectChanges();
  });

  it('shows credential configured on edit and omits an untouched credential from PATCH', () => {
    clickButton('Edit');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Credential configured');
    expect(fixture.nativeElement.querySelector('#smtp-credential')).toBeNull();

    root().querySelector<HTMLFormElement>('.editor-modal form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(service.updates).toHaveLength(1);
    expect(service.updates[0]).not.toHaveProperty('credential');
  });

  it('only sends a newly entered replacement credential after explicit replacement', () => {
    clickButton('Edit');
    fixture.detectChanges();
    clickButton('Replace credential');
    fixture.detectChanges();
    setInput('#smtp-credential', 'replacement-secret');

    root().querySelector<HTMLFormElement>('.editor-modal form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(service.updates[0].credential).toBe('replacement-secret');
  });

  it('keeps the create form open and cleared after Save & Add Another', () => {
    clickButton('Add account');
    fixture.detectChanges();
    setInput('#sender-display-name', 'First Sender');
    setInput('#sender-email', 'first@example.com');
    root().querySelector<HTMLInputElement>('#sender-email')!.dispatchEvent(new Event('blur'));
    setInput('#smtp-credential', 'new-secret');
    clickButton('Save & Add Another');
    fixture.detectChanges();

    expect(service.creates).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.editor-modal')).toBeTruthy();
    expect(root().querySelector<HTMLInputElement>('#sender-display-name')!.value).toBe('');
    expect(root().querySelector<HTMLInputElement>('#smtp-credential')!.value).toBe('');
  });

  it('requires recipient validation and explicit confirmation before sending a test email', () => {
    clickButton('Send test email');
    fixture.detectChanges();
    setInput('#test-recipient', 'recipient@example.com');
    root()
      .querySelector<HTMLFormElement>('.confirm-modal form')!
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(service.testEmailRecipients).toEqual([]);

    const confirmation = root().querySelector<HTMLInputElement>(
      'input[formControlName="confirmed"]',
    )!;
    confirmation.click();
    fixture.detectChanges();
    root()
      .querySelector<HTMLFormElement>('.confirm-modal form')!
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(service.testEmailRecipients).toEqual(['recipient@example.com']);
    expect(root().querySelector('#test-email-title')).toBeNull();
  });

  function clickButton(label: string): void {
    const button = [...root().querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label,
    );
    expect(button).toBeTruthy();
    button!.click();
  }

  function setInput(selector: string, value: string): void {
    const input = root().querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function root(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
});
