import { Routes } from '@angular/router';

import { PermissionKey, PERMISSIONS } from './core/models/auth.models';
import {
  guestGuard,
  onboardingGuard,
  permissionGuard,
  workspaceGuard,
  workspaceSelectionGuard,
} from './core/guards/auth.guard';
import { pendingChangesGuard } from './core/guards/pending-changes.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./pages/login/login.component').then((component) => component.LoginComponent),
    title: 'Sign in to PowerLead',
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./pages/forgot-password/forgot-password.component').then(
        (component) => component.ForgotPasswordComponent,
      ),
    title: 'Reset your PowerLead password',
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./pages/reset-password/reset-password.component').then(
        (component) => component.ResetPasswordComponent,
      ),
    title: 'Choose a new PowerLead password',
  },
  {
    path: 'register',
    loadComponent: () => import('./auth/register/register').then((component) => component.Register),
    title: 'Create your PowerLead account',
  },
  {
    path: 'select-workspace',
    canActivate: [workspaceSelectionGuard],
    loadComponent: () =>
      import('./pages/workspace-selector/workspace-selector.component').then(
        (component) => component.WorkspaceSelectorComponent,
      ),
    title: 'Choose a PowerLead workspace',
  },
  {
    path: 'onboarding-pending',
    canActivate: [onboardingGuard],
    loadComponent: () =>
      import('./pages/onboarding-pending/onboarding-pending.component').then(
        (component) => component.OnboardingPendingComponent,
      ),
    title: 'PowerLead onboarding pending',
  },
  {
    path: '',
    canActivate: [workspaceGuard],
    loadComponent: () =>
      import('./layout/workspace-shell/workspace-shell.component').then(
        (component) => component.WorkspaceShellComponent,
      ),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      featureRoute('overview', 'Overview', 'Workspace performance at a glance.', [
        PERMISSIONS.overviewView,
      ]),
      {
        path: 'leads',
        canActivate: [permissionGuard],
        data: { requiredPermissions: [PERMISSIONS.leadsView] },
        loadComponent: () =>
          import('./features/leads/pages/lead-list/lead-list.component').then(
            (component) => component.LeadListComponent,
          ),
        title: 'Leads | PowerLead',
      },
      {
        path: 'leads/new',
        canActivate: [permissionGuard],
        data: { requiredPermissions: [PERMISSIONS.leadsView] },
        loadComponent: () =>
          import('./features/leads/pages/lead-form-page/lead-form-page.component').then(
            (component) => component.LeadFormPageComponent,
          ),
        title: 'Create lead | PowerLead',
      },
      {
        path: 'leads/import',
        canActivate: [permissionGuard],
        data: { requiredPermissions: [PERMISSIONS.leadsImport] },
        loadComponent: () =>
          import('./features/leads/pages/lead-import/lead-import.component').then(
            (component) => component.LeadImportComponent,
          ),
        title: 'Import leads | PowerLead',
      },
      {
        path: 'leads/:id/edit',
        canActivate: [permissionGuard],
        data: { requiredPermissions: [PERMISSIONS.leadsUpdate] },
        loadComponent: () =>
          import('./features/leads/pages/lead-form-page/lead-form-page.component').then(
            (component) => component.LeadFormPageComponent,
          ),
        title: 'Edit lead | PowerLead',
      },
      {
        path: 'leads/:id',
        canActivate: [permissionGuard],
        data: { requiredPermissions: [PERMISSIONS.leadsView] },
        loadComponent: () =>
          import('./features/leads/pages/lead-detail/lead-detail.component').then(
            (component) => component.LeadDetailComponent,
          ),
        title: 'Lead details | PowerLead',
      },
      {
        path: 'customers',
        canActivate: [permissionGuard],
        data: { requiredPermissions: [PERMISSIONS.customersView] },
        loadComponent: () =>
          import('./features/customers/pages/customer-list/customer-list.component').then(
            (component) => component.CustomerListComponent,
          ),
        title: 'Customers | PowerLead',
      },
      {
        path: 'customers/:id',
        canActivate: [permissionGuard],
        data: { requiredPermissions: [PERMISSIONS.customersView] },
        loadComponent: () =>
          import('./features/customers/pages/customer-detail/customer-detail.component').then(
            (component) => component.CustomerDetailComponent,
          ),
        title: 'Customer details | PowerLead',
      },
      { path: 'tasks', pathMatch: 'full', redirectTo: 'tasks/my' },
      taskRoute('tasks/my', 'My Tasks', 'mine'),
      taskRoute('tasks/today', 'Today', 'today'),
      taskRoute('tasks/overdue', 'Overdue', 'overdue'),
      featureRoute(
        'workflows',
        'Workflows',
        'Build and monitor lead workflows.',
        [PERMISSIONS.workflowsView],
        [PERMISSIONS.workflowsCreate, PERMISSIONS.workflowsUpdate, PERMISSIONS.workflowsDelete],
      ),
      featureRoute(
        'audits',
        'Audits',
        'Inspect workspace activity and audit history.',
        [PERMISSIONS.auditsView],
        [PERMISSIONS.auditsCreate, PERMISSIONS.auditsUpdate, PERMISSIONS.auditsDelete],
      ),
      featureRoute(
        'templates',
        'Templates',
        'Create and organize reusable templates.',
        [PERMISSIONS.templatesView],
        [PERMISSIONS.templatesCreate, PERMISSIONS.templatesUpdate, PERMISSIONS.templatesDelete],
      ),
      { path: 'messages', pathMatch: 'full', redirectTo: 'messages/whatsapp' },
      {
        path: 'messages/whatsapp',
        canActivate: [permissionGuard],
        data: { requiredPermissions: [PERMISSIONS.messagesView] },
        loadComponent: () =>
          import('./features/whatsapp/pages/whatsapp-inbox/whatsapp-inbox.component').then(
            (component) => component.WhatsAppInboxComponent,
          ),
        title: 'WhatsApp Messages | PowerLead',
      },
      {
        path: 'messages/messenger',
        canActivate: [permissionGuard],
        data: { requiredPermissions: [PERMISSIONS.messagesView] },
        loadComponent: () =>
          import('./features/messenger/pages/messenger-inbox/messenger-inbox.component').then(
            (component) => component.MessengerInboxComponent,
          ),
        title: 'Messenger Messages | PowerLead',
      },
      {
        path: 'messages/instagram',
        canActivate: [permissionGuard],
        data: { requiredPermissions: [PERMISSIONS.messagesView] },
        loadComponent: () =>
          import('./features/instagram/pages/instagram-inbox/instagram-inbox.component').then(
            (component) => component.InstagramInboxComponent,
          ),
        title: 'Instagram Messages | PowerLead',
      },
      { path: 'mail', pathMatch: 'full', redirectTo: 'mail/sender-accounts' },
      {
        path: 'mail/sender-accounts',
        canActivate: [permissionGuard],
        data: { requiredPermissions: [PERMISSIONS.mailView] },
        loadComponent: () =>
          import('./features/mail/sender-accounts/sender-accounts.component').then(
            (component) => component.SenderAccountsComponent,
          ),
        title: 'Sender Accounts | PowerLead',
      },
      {
        path: 'mail/templates',
        canActivate: [permissionGuard],
        canDeactivate: [pendingChangesGuard],
        data: { requiredPermissions: [PERMISSIONS.mailTemplatesView] },
        loadComponent: () =>
          import('./features/mail/templates/mail-template-list.component').then(
            (component) => component.MailTemplateListComponent,
          ),
        title: 'Mail Templates | PowerLead',
      },
      {
        path: 'mail/templates/new',
        canActivate: [permissionGuard],
        canDeactivate: [pendingChangesGuard],
        data: { requiredPermissions: [PERMISSIONS.mailTemplatesManage] },
        loadComponent: () =>
          import('./features/mail/templates/mail-template-editor.component').then(
            (component) => component.MailTemplateEditorComponent,
          ),
        title: 'Create Mail Template | PowerLead',
      },
      {
        path: 'mail/templates/:id/edit',
        canActivate: [permissionGuard],
        canDeactivate: [pendingChangesGuard],
        data: { requiredPermissions: [PERMISSIONS.mailTemplatesManage] },
        loadComponent: () =>
          import('./features/mail/templates/mail-template-editor.component').then(
            (component) => component.MailTemplateEditorComponent,
          ),
        title: 'Edit Mail Template | PowerLead',
      },
      {
        path: 'settings',
        canActivate: [permissionGuard],
        data: {
          requiredPermissions: [
            PERMISSIONS.settingsRolesView,
            PERMISSIONS.settingsUsersView,
            PERMISSIONS.settingsMenuPermissionsView,
          ],
          permissionMatch: 'any',
        },
        loadComponent: () =>
          import('./features/settings/settings-shell/settings-shell.component').then(
            (component) => component.SettingsShellComponent,
          ),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/settings/settings-home/settings-home.component').then(
                (component) => component.SettingsHomeComponent,
              ),
            title: 'Settings | PowerLead',
          },
          {
            path: 'roles',
            canActivate: [permissionGuard],
            data: { requiredPermissions: [PERMISSIONS.settingsRolesView] },
            loadComponent: () =>
              import('./features/settings/roles/roles.component').then(
                (component) => component.RolesComponent,
              ),
            title: 'Role Setup | PowerLead',
          },
          {
            path: 'users',
            canActivate: [permissionGuard],
            data: { requiredPermissions: [PERMISSIONS.settingsUsersView] },
            loadComponent: () =>
              import('./features/settings/users/users.component').then(
                (component) => component.UsersComponent,
              ),
            title: 'User Setup | PowerLead',
          },
          {
            path: 'menu-permissions',
            canActivate: [permissionGuard],
            data: { requiredPermissions: [PERMISSIONS.settingsMenuPermissionsView] },
            loadComponent: () =>
              import('./features/settings/menu-permissions/menu-permissions.component').then(
                (component) => component.MenuPermissionsComponent,
              ),
            title: 'Menu Permission | PowerLead',
          },
        ],
      },
      {
        path: 'access-denied',
        loadComponent: () =>
          import('./pages/access-denied/access-denied.component').then(
            (component) => component.AccessDeniedComponent,
          ),
        title: 'Access denied',
      },
    ],
  },
  { path: '**', redirectTo: 'overview' },
];

function featureRoute(
  path: string,
  pageTitle: string,
  description: string,
  requiredPermissions: PermissionKey[],
  writePermissions: PermissionKey[] = [],
) {
  return {
    path,
    canActivate: [permissionGuard],
    loadComponent: () =>
      import('./pages/workspace-page/workspace-page.component').then(
        (component) => component.WorkspacePageComponent,
      ),
    title: `${pageTitle} | PowerLead`,
    data: { pageTitle, description, requiredPermissions, writePermissions },
  } satisfies Routes[number];
}

function taskRoute(path: string, taskTitle: string, taskView: 'mine' | 'today' | 'overdue') {
  return {
    path,
    canActivate: [permissionGuard],
    data: { requiredPermissions: [PERMISSIONS.leadsView], taskTitle, taskView },
    loadComponent: () =>
      import('./features/tasks/pages/task-list/task-list.component').then(
        (component) => component.TaskListComponent,
      ),
    title: `${taskTitle} | PowerLead`,
  } satisfies Routes[number];
}
