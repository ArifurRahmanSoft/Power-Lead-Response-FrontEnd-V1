export type AuthStatus =
  'workspace_selected' | 'workspace_selection_required' | 'onboarding_pending';

export type SystemWorkspaceRole = 'owner' | 'operator' | 'staff' | 'readonly';

// The backend can return tenant-defined role keys as well as the four system roles.
export type WorkspaceRole = SystemWorkspaceRole | (string & {});

export const PERMISSIONS = {
  tenantUsersManage: 'tenant.users.manage',
  tenantSettingsManage: 'tenant.settings.manage',
  templatesRead: 'templates.read',
  templatesDraft: 'templates.draft',
  templatesApprove: 'templates.approve',
  workflowsRead: 'workflows.read',
  workflowsDraft: 'workflows.draft',
  workflowsApprove: 'workflows.approve',
  leadsRead: 'leads.read',
  leadsManage: 'leads.manage',
  leadsAssignedUpdate: 'leads.assigned.update',
  auditsRead: 'audits.read',
  auditsManage: 'audits.manage',
  dashboardRead: 'dashboard.read',
  integrationsUse: 'integrations.use',
  overviewView: 'overview.view',
  leadsView: 'leads.view',
  leadsCreate: 'leads.create',
  leadsUpdate: 'leads.update',
  leadsDelete: 'leads.delete',
  leadsExport: 'leads.export',
  leadsImport: 'leads.import',
  leadsAssign: 'leads.assign',
  leadsStatus: 'leads.status',
  workflowsView: 'workflows.view',
  workflowsCreate: 'workflows.create',
  workflowsUpdate: 'workflows.update',
  workflowsDelete: 'workflows.delete',
  workflowsActivate: 'workflows.activate',
  auditsView: 'audits.view',
  auditsCreate: 'audits.create',
  auditsUpdate: 'audits.update',
  auditsDelete: 'audits.delete',
  auditsExport: 'audits.export',
  templatesView: 'templates.view',
  templatesCreate: 'templates.create',
  templatesUpdate: 'templates.update',
  templatesDelete: 'templates.delete',
  settingsRolesView: 'settings.roles.view',
  settingsRolesCreate: 'settings.roles.create',
  settingsRolesUpdate: 'settings.roles.update',
  settingsRolesDelete: 'settings.roles.delete',
  settingsUsersView: 'settings.users.view',
  settingsUsersCreate: 'settings.users.create',
  settingsUsersUpdate: 'settings.users.update',
  settingsUsersDelete: 'settings.users.delete',
  settingsUsersResetPassword: 'settings.users.reset_password',
  settingsMenuPermissionsView: 'settings.menu_permissions.view',
  settingsMenuPermissionsUpdate: 'settings.menu_permissions.update',
  settingsIntegrationsView: 'settings.integrations.view',
  settingsIntegrationsUpdate: 'settings.integrations.update',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface RegisterRequest {
  name: string;
  email: string;
  login_id?: string;
  password: string;
  confirm_password: string;
}

export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  login_id: string;
}

export interface RegisterResponse {
  success: boolean;
  message: string;
  data: RegisteredUser;
}

export interface LoginRequest {
  identifier: string;
  password: string;
}

export interface AuthUser {
  id: string;
  login_id: string;
  name: string;
  email: string;
}

export interface SelectedWorkspace {
  id: string;
  name: string;
  slug: string;
}

export interface WorkspaceChoice extends SelectedWorkspace {
  role: WorkspaceRole;
}

export interface AuthSessionData {
  auth_status: AuthStatus;
  user: AuthUser;
  selected_workspace: SelectedWorkspace | null;
  role: WorkspaceRole | null;
  permissions: PermissionKey[];
  workspaces: WorkspaceChoice[];
}

export interface LoginData extends AuthSessionData {
  access_token: string;
  token_type: string;
}

export interface LoginResponse {
  success: boolean;
  message: string;
  data: LoginData;
}

export interface MeResponse {
  success: boolean;
  data: AuthSessionData;
}

export interface WorkspaceSelectionRequest {
  workspace_id: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  new_password: string;
  confirm_password: string;
}

export interface PasswordResetResponse {
  success: boolean;
  message: string;
}

export interface ApiFieldError {
  field?: string;
  message?: string;
}

export interface ApiProblem {
  detail?: string | FastApiValidationError[];
  message?: string;
  errors?: Record<string, string[] | string> | ApiFieldError[];
}

export interface FastApiValidationError {
  loc?: Array<string | number>;
  field?: string;
  msg?: string;
  message?: string;
}
