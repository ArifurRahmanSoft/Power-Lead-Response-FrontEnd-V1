import { PermissionKey, PERMISSIONS, WorkspaceRole } from '../models/auth.models';

export interface MenuItem {
  label: string;
  path: string;
  icon: string;
  requiredPermissions: PermissionKey[];
  permissionMatch?: 'all' | 'any';
  roleLabels?: Partial<Record<WorkspaceRole, string>>;
  children?: readonly MenuChildItem[];
}

export interface MenuChildItem {
  label: string;
  path: string;
  requiredPermissions: PermissionKey[];
}

export interface SettingsMenuItem {
  label: string;
  description: string;
  path: string;
  requiredPermission: PermissionKey;
}

export const SETTINGS_MENU: readonly SettingsMenuItem[] = [
  {
    label: 'Role',
    description: 'Create and maintain workspace roles.',
    path: '/settings/roles',
    requiredPermission: PERMISSIONS.settingsRolesView,
  },
  {
    label: 'User Setup',
    description: 'Manage users and workspace access.',
    path: '/settings/users',
    requiredPermission: PERMISSIONS.settingsUsersView,
  },
  {
    label: 'Menu Permission',
    description: 'Configure role access by menu and action.',
    path: '/settings/menu-permissions',
    requiredPermission: PERMISSIONS.settingsMenuPermissionsView,
  },
];

export const WORKSPACE_MENU: readonly MenuItem[] = [
  {
    label: 'Overview',
    path: '/overview',
    icon: 'overview',
    requiredPermissions: [PERMISSIONS.overviewView],
  },
  {
    label: 'Leads',
    path: '/leads',
    icon: 'leads',
    requiredPermissions: [PERMISSIONS.leadsView],
    roleLabels: { staff: 'Assigned leads' },
  },
  {
    label: 'Customers',
    path: '/customers',
    icon: 'customers',
    requiredPermissions: [PERMISSIONS.customersView],
  },
  {
    label: 'Tasks',
    path: '/tasks',
    icon: 'tasks',
    requiredPermissions: [PERMISSIONS.leadsView],
    children: [
      {
        label: 'My Tasks',
        path: '/tasks/my',
        requiredPermissions: [PERMISSIONS.leadsView],
      },
      {
        label: 'Today',
        path: '/tasks/today',
        requiredPermissions: [PERMISSIONS.leadsView],
      },
      {
        label: 'Overdue',
        path: '/tasks/overdue',
        requiredPermissions: [PERMISSIONS.leadsView],
      },
    ],
  },
  {
    label: 'Workflows',
    path: '/workflows',
    icon: 'workflows',
    requiredPermissions: [PERMISSIONS.workflowsView],
  },
  {
    label: 'Audits',
    path: '/audits',
    icon: 'audits',
    requiredPermissions: [PERMISSIONS.auditsView],
  },
  {
    label: 'Templates',
    path: '/templates',
    icon: 'templates',
    requiredPermissions: [PERMISSIONS.templatesView],
  },
  {
    label: 'Messages',
    path: '/messages',
    icon: 'messages',
    requiredPermissions: [PERMISSIONS.messagesView],
    children: [
      {
        label: 'WhatsApp',
        path: '/messages/whatsapp',
        requiredPermissions: [PERMISSIONS.messagesView],
      },
      {
        label: 'Messenger',
        path: '/messages/messenger',
        requiredPermissions: [PERMISSIONS.messagesView],
      },
    ],
  },
  {
    label: 'Mail',
    path: '/mail',
    icon: 'mail',
    requiredPermissions: [PERMISSIONS.mailView, PERMISSIONS.mailTemplatesView],
    permissionMatch: 'any',
    children: [
      {
        label: 'Sender Accounts',
        path: '/mail/sender-accounts',
        requiredPermissions: [PERMISSIONS.mailView],
      },
      {
        label: 'Mail Templates',
        path: '/mail/templates',
        requiredPermissions: [PERMISSIONS.mailTemplatesView],
      },
    ],
  },
  {
    label: 'Settings',
    path: '/settings',
    icon: 'settings',
    requiredPermissions: [
      PERMISSIONS.settingsRolesView,
      PERMISSIONS.settingsUsersView,
      PERMISSIONS.settingsMenuPermissionsView,
    ],
    permissionMatch: 'any',
  },
];

export function availableMenuItems(
  role: WorkspaceRole | null,
  permissions: readonly PermissionKey[],
): MenuItem[] {
  return WORKSPACE_MENU.filter((item) =>
    item.permissionMatch === 'any'
      ? item.requiredPermissions.some((permission) => permissions.includes(permission))
      : item.requiredPermissions.every((permission) => permissions.includes(permission)),
  ).map((item) => ({
    ...item,
    children: item.children?.filter((child) =>
      child.requiredPermissions.every((permission) => permissions.includes(permission)),
    ),
  }));
}

export function availableSettingsMenuItems(
  permissions: readonly PermissionKey[],
): SettingsMenuItem[] {
  return SETTINGS_MENU.filter((item) => permissions.includes(item.requiredPermission));
}
