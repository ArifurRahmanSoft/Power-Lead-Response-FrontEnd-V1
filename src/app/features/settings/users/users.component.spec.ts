import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { PermissionKey, PERMISSIONS } from '../../../core/models/auth.models';
import { UserSetupCreateRequest } from '../../../core/models/settings.models';
import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { UsersComponent } from './users.component';

class FakeAuthService {
  readonly permissions = signal<readonly PermissionKey[]>(Object.values(PERMISSIONS));
  readonly user = signal({ id: 'current-owner' });
  hasPermission() {
    return true;
  }
}

class FakeSettingsService {
  createRequest?: UserSetupCreateRequest;
  revokedUserId?: string;
  readonly role = { id: 'staff-id', key: 'staff', name: 'Staff', is_system: true };
  readonly user = {
    id: 'user-id',
    membership_id: 'membership-id',
    display_name: 'Existing User',
    email: 'existing@example.com',
    login_id: 'existing.user',
    role_id: 'staff-id',
    role_name: 'Staff',
    is_active: true,
  };

  listUsers() {
    return of({ success: true, data: { items: [this.user], page: 1, size: 10, total: 1 } });
  }
  listRoles() {
    return of({ success: true, data: { items: [this.role], page: 1, size: 100, total: 1 } });
  }
  createUser(request: UserSetupCreateRequest) {
    this.createRequest = request;
    return of({ success: true, message: 'Tenant user created', data: this.user });
  }
  updateUser() {
    return of({ success: true, message: 'Tenant user updated', data: this.user });
  }
  resetUserPassword() {
    return of({ success: true, message: 'Password reset successful' });
  }
  revokeUser(userId: string) {
    this.revokedUserId = userId;
    return of({ success: true, message: 'Tenant access revoked' });
  }
}

describe('UsersComponent', () => {
  let settings: FakeSettingsService;

  beforeEach(async () => {
    settings = new FakeSettingsService();
    await TestBed.configureTestingModule({
      imports: [UsersComponent],
      providers: [
        provideRouter([]),
        { provide: SettingsService, useValue: settings },
        { provide: AuthService, useClass: FakeAuthService },
      ],
    }).compileComponents();
  });

  it('populates roles and sends the backend user contract without altering passwords', () => {
    const fixture = TestBed.createComponent(UsersComponent);
    fixture.detectChanges();
    clickButton(fixture.nativeElement, 'Add user');
    fixture.detectChanges();

    setInput(fixture.nativeElement, '#create-name', '  Jane Doe  ');
    setInput(fixture.nativeElement, '#create-login-id', '  Jane.Doe  ');
    setInput(fixture.nativeElement, '#create-email', '  JANE@EXAMPLE.COM  ');
    setInput(fixture.nativeElement, '#create-password', '  exact password  ');
    setInput(fixture.nativeElement, '#create-confirm-password', '  exact password  ');
    setSelect(fixture.nativeElement, '#create-role', 'staff-id');
    fixture.nativeElement.querySelector('.modal form').dispatchEvent(new Event('submit'));

    expect(settings.createRequest).toEqual({
      display_name: 'Jane Doe',
      email: 'jane@example.com',
      login_id: 'jane.doe',
      password: '  exact password  ',
      confirm_password: '  exact password  ',
      role_id: 'staff-id',
    });
  });

  it('blocks mismatched passwords and never renders a stored password', () => {
    const fixture = TestBed.createComponent(UsersComponent);
    fixture.detectChanges();
    clickButton(fixture.nativeElement, 'Add user');
    fixture.detectChanges();
    setInput(fixture.nativeElement, '#create-password', 'one-password');
    setInput(fixture.nativeElement, '#create-confirm-password', 'another-password');
    fixture.nativeElement.querySelector('.modal form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Passwords must match');
    expect(settings.createRequest).toBeUndefined();

    clickButton(fixture.nativeElement, 'Cancel');
    fixture.detectChanges();
    clickButton(fixture.nativeElement, 'Edit');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.modal input[type="password"]').length).toBe(0);
  });

  it('explains that delete revokes only workspace access', () => {
    const fixture = TestBed.createComponent(UsersComponent);
    fixture.detectChanges();
    clickButton(fixture.nativeElement, 'Revoke');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('does not delete');
    expect(fixture.nativeElement.textContent).toContain('last active owner');
    clickButton(fixture.nativeElement, 'Revoke access');
    expect(settings.revokedUserId).toBe('user-id');
  });
});

function clickButton(root: HTMLElement, text: string): void {
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    item.textContent?.includes(text),
  );
  button?.click();
}
function setInput(root: HTMLElement, selector: string, value: string): void {
  const input = root.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
function setSelect(root: HTMLElement, selector: string, value: string): void {
  const select = root.querySelector<HTMLSelectElement>(selector)!;
  select.value = value;
  select.dispatchEvent(new Event('change'));
}
