import { availableMenuItems, availableSettingsMenuItems } from './menu.config';
import { PermissionKey, PERMISSIONS, WorkspaceRole } from '../models/auth.models';

const allPermissions = Object.values(PERMISSIONS) as PermissionKey[];

describe('workspace menu policy', () => {
  it('shows every configured screen to an owner with full permissions', () => {
    expect(availableMenuItems('owner', allPermissions).map((item) => item.label)).toEqual([
      'Overview',
      'Leads',
      'Customers',
      'Tasks',
      'Workflows',
      'Audits',
      'Templates',
      'Messages',
      'Mail',
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

  it('limits staff navigation to overview, assigned leads, and authorized tasks', () => {
    const items = availableMenuItems('staff', [
      PERMISSIONS.overviewView,
      PERMISSIONS.leadsView,
      PERMISSIONS.customersView,
    ]);
    expect(items.map((item) => item.path)).toEqual(['/overview', '/leads', '/customers', '/tasks']);
    expect(items[1].roleLabels?.staff).toBe('Assigned leads');
    expect(items[3].children?.map((item) => item.path)).toEqual([
      '/tasks/my',
      '/tasks/today',
      '/tasks/overdue',
    ]);
  });

  it('shows readonly users only read screens returned by the backend', () => {
    const permissions: PermissionKey[] = [
      PERMISSIONS.overviewView,
      PERMISSIONS.leadsView,
      PERMISSIONS.customersView,
      PERMISSIONS.templatesView,
      PERMISSIONS.workflowsView,
      PERMISSIONS.auditsView,
    ];
    expect(availableMenuItems('readonly', permissions).map((item) => item.path)).toEqual([
      '/overview',
      '/leads',
      '/customers',
      '/tasks',
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

  it('shows the Sender Accounts submenu only with mail view permission', () => {
    expect(availableMenuItems('owner', [PERMISSIONS.mailManage])).toEqual([]);
    const mail = availableMenuItems('owner', [PERMISSIONS.mailView])[0];
    expect(mail.label).toBe('Mail');
    expect(mail.children?.map((item) => item.path)).toEqual(['/mail/sender-accounts']);
  });

  it('shows Mail Templates independently using its backend permission', () => {
    const mail = availableMenuItems('owner', [PERMISSIONS.mailTemplatesView])[0];
    expect(mail.path).toBe('/mail');
    expect(mail.children?.map((item) => item.path)).toEqual(['/mail/templates']);
  });

  it('shows WhatsApp and Messenger only when the backend grants messages view', () => {
    expect(availableMenuItems('owner', [PERMISSIONS.messagesSend])).toEqual([]);
    const messages = availableMenuItems('owner', [PERMISSIONS.messagesView])[0];
    expect(messages.path).toBe('/messages');
    expect(messages.children?.map((item) => item.path)).toEqual([
      '/messages/whatsapp',
      '/messages/messenger',
    ]);
  });
});
