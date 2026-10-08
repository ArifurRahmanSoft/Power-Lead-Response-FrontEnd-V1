import { availableMenuItems, availableSettingsMenuItems } from './menu.config';
import { PermissionKey, PERMISSIONS, WorkspaceRole } from '../models/auth.models';

const allPermissions = Object.values(PERMISSIONS) as PermissionKey[];

describe('workspace menu policy', () => {
  it('shows every configured screen to an owner with full permissions', () => {
    expect(availableMenuItems('owner', allPermissions).map((item) => item.label)).toEqual([
      'Overview',
      'Leads',
      'Workflows',
      'Audits',
      'Templates',
      'Settings',
    ]);
  });

  it('shows an operator settings only when that permission is delegated', () => {
    const base: PermissionKey[] = [
      PERMISSIONS.overviewView,
      PERMISSIONS.leadsView,
      PERMISSIONS.workflowsView,
      PERMISSIONS.auditsView,
      PERMISSIONS.templatesView,
    ];
    expect(availableMenuItems('operator', base).some((item) => item.path === '/settings')).toBe(
      false,
    );
    expect(
      availableMenuItems('operator', [...base, PERMISSIONS.settingsRolesView]).some(
        (item) => item.path === '/settings',
      ),
    ).toBe(true);
  });

  it('limits staff navigation to overview and assigned leads', () => {
    const items = availableMenuItems('staff', [PERMISSIONS.overviewView, PERMISSIONS.leadsView]);
    expect(items.map((item) => item.path)).toEqual(['/overview', '/leads']);
    expect(items[1].roleLabels?.staff).toBe('Assigned leads');
  });

  it('shows readonly users only read screens returned by the backend', () => {
    const permissions: PermissionKey[] = [
      PERMISSIONS.overviewView,
      PERMISSIONS.leadsView,
      PERMISSIONS.templatesView,
      PERMISSIONS.workflowsView,
      PERMISSIONS.auditsView,
    ];
    expect(availableMenuItems('readonly', permissions).map((item) => item.path)).toEqual([
      '/overview',
      '/leads',
      '/workflows',
      '/audits',
      '/templates',
    ]);
  });

  it('shows only settings submenus allowed by effective permissions', () => {
    expect(
      availableSettingsMenuItems([
        PERMISSIONS.settingsUsersView,
        PERMISSIONS.settingsMenuPermissionsView,
      ]).map((item) => item.path),
    ).toEqual(['/settings/users', '/settings/menu-permissions']);
  });

  it('uses backend permissions rather than a built-in role allowlist', () => {
    expect(
      availableMenuItems('custom-sales-manager' as WorkspaceRole, [
        PERMISSIONS.overviewView,
        PERMISSIONS.workflowsView,
        PERMISSIONS.settingsRolesView,
      ]).map((item) => item.path),
    ).toEqual(['/overview', '/workflows', '/settings']);
  });
});
