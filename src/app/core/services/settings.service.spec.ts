import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../config/api.config';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SettingsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SettingsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uses the paginated role contract and role CRUD endpoints', () => {
    service.listRoles(2, 10).subscribe();
    const list = http.expectOne(`${API_CONFIG.baseUrl}/settings/roles?page=2&size=10`);
    expect(list.request.method).toBe('GET');
    list.flush({ success: true, data: { items: [], page: 2, size: 10, total: 0 } });

    service.createRole({ name: 'Sales' }).subscribe();
    const create = http.expectOne(`${API_CONFIG.baseUrl}/settings/roles`);
    expect(create.request.body).toEqual({ name: 'Sales' });
    create.flush({ success: true, message: 'Role created', data: {} });

    service.updateRole('role-id', { name: 'Sales Lead' }).subscribe();
    const update = http.expectOne(`${API_CONFIG.baseUrl}/settings/roles/role-id`);
    expect(update.request.method).toBe('PATCH');
    update.flush({ success: true, message: 'Role updated', data: {} });

    service.deleteRole('role-id').subscribe();
    const remove = http.expectOne(`${API_CONFIG.baseUrl}/settings/roles/role-id`);
    expect(remove.request.method).toBe('DELETE');
    remove.flush({ success: true, message: 'Role deleted' });
  });

  it('sends the exact user creation, update, reset, and revoke contracts', () => {
    const createRequest = {
      display_name: 'Jane Doe',
      email: 'jane@example.com',
      login_id: 'jane.doe',
      password: '  exact password  ',
      confirm_password: '  exact password  ',
      role_id: 'role-id',
    };
    service.createUser(createRequest).subscribe();
    const create = http.expectOne(`${API_CONFIG.baseUrl}/settings/users`);
    expect(create.request.body).toEqual(createRequest);
    create.flush({ success: true, message: 'Tenant user created', data: {} });

    service.updateUser('user-id', { display_name: 'Jane D', role_id: 'role-2' }).subscribe();
    const update = http.expectOne(`${API_CONFIG.baseUrl}/settings/users/user-id`);
    expect(update.request.body).toEqual({ display_name: 'Jane D', role_id: 'role-2' });
    update.flush({ success: true, message: 'Tenant user updated', data: {} });

    service
      .resetUserPassword('user-id', {
        password: 'new password',
        confirm_password: 'new password',
      })
      .subscribe();
    const reset = http.expectOne(`${API_CONFIG.baseUrl}/settings/users/user-id/reset-password`);
    expect(reset.request.body).toEqual({
      password: 'new password',
      confirm_password: 'new password',
    });
    reset.flush({ success: true, message: 'Password reset successful' });

    service.revokeUser('user-id').subscribe();
    const revoke = http.expectOne(`${API_CONFIG.baseUrl}/settings/users/user-id`);
    expect(revoke.request.method).toBe('DELETE');
    revoke.flush({ success: true, message: 'Tenant access revoked' });
  });

  it('loads the catalog and saves a role permission set', () => {
    service.getMenuCatalog().subscribe();
    http
      .expectOne(`${API_CONFIG.baseUrl}/settings/menu-catalog`)
      .flush({ success: true, data: [] });

    service.getRolePermissions('role-id').subscribe();
    http.expectOne(`${API_CONFIG.baseUrl}/settings/roles/role-id/permissions`).flush({
      success: true,
      data: { role_id: 'role-id', role_name: 'Sales', permission_keys: [] },
    });

    service
      .updateRolePermissions('role-id', {
        permission_keys: ['leads.view', 'leads.update'],
      })
      .subscribe();
    const save = http.expectOne(`${API_CONFIG.baseUrl}/settings/roles/role-id/permissions`);
    expect(save.request.method).toBe('PUT');
    expect(save.request.body).toEqual({ permission_keys: ['leads.view', 'leads.update'] });
    save.flush({
      success: true,
      message: 'Role permissions updated',
      data: {
        role_id: 'role-id',
        role_name: 'Sales',
        permission_keys: ['leads.view', 'leads.update'],
      },
    });
  });
});
