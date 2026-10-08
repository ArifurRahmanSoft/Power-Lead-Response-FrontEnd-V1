import { PermissionKey } from './auth.models';

export interface SettingsRole {
  id: string;
  key: string;
  name: string;
  is_system: boolean;
}

export interface PaginatedData<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface ApiDataResponse<T> {
  success: boolean;
  data: T;
}

export interface ApiMutationResponse<T> extends ApiDataResponse<T> {
  message: string;
}

export interface ApiActionResponse {
  success: boolean;
  message: string;
}

export interface RoleNameRequest {
  name: string;
}

export interface SettingsUser {
  id: string;
  membership_id: string;
  display_name: string;
  email: string;
  login_id: string;
  role_id: string;
  role_name: string;
  is_active: boolean;
}

export interface UserSetupCreateRequest {
  display_name: string;
  email: string;
  login_id: string;
  password: string;
  confirm_password: string;
  role_id: string;
}

export interface UserSetupUpdateRequest {
  display_name?: string;
  role_id?: string;
}

export interface AdminPasswordResetRequest {
  password: string;
  confirm_password: string;
}

export type MenuAction =
  | 'view'
  | 'create'
  | 'update'
  | 'delete'
  | 'export'
  | 'import'
  | 'assign'
  | 'status'
  | 'activate'
  | 'approve'
  | 'reset_password';

export interface MenuCatalogItem {
  key: string;
  label: string;
  actions: MenuAction[];
  permission_keys: PermissionKey[];
}

export interface RolePermissionData {
  role_id: string;
  role_name: string;
  permission_keys: PermissionKey[];
}

export interface RolePermissionUpdateRequest {
  permission_keys: PermissionKey[];
}
