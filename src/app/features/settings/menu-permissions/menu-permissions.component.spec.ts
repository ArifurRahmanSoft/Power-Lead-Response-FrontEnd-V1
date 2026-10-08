import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { PermissionKey, PERMISSIONS } from '../../../core/models/auth.models';
import { RolePermissionUpdateRequest } from '../../../core/models/settings.models';
import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { MenuPermissionsComponent } from './menu-permissions.component';

class FakeAuthService {
  readonly role = signal<'owner'>('owner');
  readonly permissions = signal<readonly PermissionKey[]>(Object.values(PERMISSIONS));
  hasPermission(permission: PermissionKey) {
    return this.permissions().includes(permission);
  }
  refreshCurrentSession() {
    return of(true);
  }
}

class FakeSettingsService {
  saved?: RolePermissionUpdateRequest;
  readonly owner = { id: 'owner-id', key: 'owner', name: 'Owner', is_system: true };

  listRoles() {
    return of({ success: true, data: { items: [this.owner], page: 1, size: 100, total: 1 } });
  }
  getMenuCatalog() {
    return of({
      success: true,
      data: [
        {
          key: 'leads',
          label: 'Leads',
          actions: ['view', 'update'],
          permission_keys: ['leads.view', 'leads.update'],
        },
        {
          key: 'settings.roles',
          label: 'Role Setup',
          actions: ['view', 'create'],
          permission_keys: ['settings.roles.view', 'settings.roles.create'],
        },
      ],
    });
  }
  getRolePermissions() {
    return of({
      success: true,
      data: {
        role_id: 'owner-id',
        role_name: 'Owner',
        permission_keys: ['settings.roles.view', 'settings.roles.create'],
      },
    });
  }
  updateRolePermissions(_roleId: string, request: RolePermissionUpdateRequest) {
    this.saved = request;
    return of({
      success: true,
      message: 'Role permissions updated',
      data: { role_id: 'owner-id', role_name: 'Owner', permission_keys: request.permission_keys },
    });
  }
}

describe('MenuPermissionsComponent', () => {
  let settings: FakeSettingsService;

  beforeEach(async () => {
    settings = new FakeSettingsService();
    await TestBed.configureTestingModule({
      imports: [MenuPermissionsComponent],
      providers: [
        provideRouter([]),
        { provide: SettingsService, useValue: settings },
        { provide: AuthService, useClass: FakeAuthService },
      ],
    }).compileComponents();
  });

  it('adds view when a write action is enabled and saves the matrix', () => {
    const fixture = TestBed.createComponent(MenuPermissionsComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const update = root.querySelector<HTMLInputElement>('input[aria-label="Leads update"]')!;
    update.checked = true;
    update.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(root.querySelector<HTMLInputElement>('input[aria-label="Leads view"]')?.checked).toBe(
      true,
    );
    expect(root.textContent).toContain('unsaved changes');
    clickButton(root, 'Save permissions');
    expect(settings.saved?.permission_keys).toContain('leads.view');
    expect(settings.saved?.permission_keys).toContain('leads.update');
  });

  it('locks required owner management permissions', () => {
    const fixture = TestBed.createComponent(MenuPermissionsComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const permission = root.querySelector<HTMLInputElement>('input[aria-label="Role Setup view"]')!;
    expect(permission.checked).toBe(true);
    expect(permission.disabled).toBe(true);
  });
});

function clickButton(root: HTMLElement, text: string): void {
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    item.textContent?.includes(text),
  );
  button?.click();
}
