import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../config/api.config';
import {
  AdminPasswordResetRequest,
  ApiActionResponse,
  ApiDataResponse,
  ApiMutationResponse,
  MenuCatalogItem,
  PaginatedData,
  RoleNameRequest,
  RolePermissionData,
  RolePermissionUpdateRequest,
  SettingsRole,
  SettingsUser,
  UserSetupCreateRequest,
  UserSetupUpdateRequest,
} from '../models/settings.models';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${API_CONFIG.baseUrl}/settings`;

  listRoles(page = 1, size = 20): Observable<ApiDataResponse<PaginatedData<SettingsRole>>> {
    return this.http.get<ApiDataResponse<PaginatedData<SettingsRole>>>(`${this.baseUrl}/roles`, {
      params: this.paginationParams(page, size),
    });
  }

  createRole(request: RoleNameRequest): Observable<ApiMutationResponse<SettingsRole>> {
    return this.http.post<ApiMutationResponse<SettingsRole>>(`${this.baseUrl}/roles`, request);
  }

  updateRole(
    roleId: string,
    request: RoleNameRequest,
  ): Observable<ApiMutationResponse<SettingsRole>> {
    return this.http.patch<ApiMutationResponse<SettingsRole>>(
      `${this.baseUrl}/roles/${roleId}`,
      request,
    );
  }

  deleteRole(roleId: string): Observable<ApiActionResponse> {
    return this.http.delete<ApiActionResponse>(`${this.baseUrl}/roles/${roleId}`);
  }

  listUsers(page = 1, size = 20): Observable<ApiDataResponse<PaginatedData<SettingsUser>>> {
    return this.http.get<ApiDataResponse<PaginatedData<SettingsUser>>>(`${this.baseUrl}/users`, {
      params: this.paginationParams(page, size),
    });
  }

  createUser(request: UserSetupCreateRequest): Observable<ApiMutationResponse<SettingsUser>> {
    return this.http.post<ApiMutationResponse<SettingsUser>>(`${this.baseUrl}/users`, request);
  }

  updateUser(
    userId: string,
    request: UserSetupUpdateRequest,
  ): Observable<ApiMutationResponse<SettingsUser>> {
    return this.http.patch<ApiMutationResponse<SettingsUser>>(
      `${this.baseUrl}/users/${userId}`,
      request,
    );
  }

  revokeUser(userId: string): Observable<ApiActionResponse> {
    return this.http.delete<ApiActionResponse>(`${this.baseUrl}/users/${userId}`);
  }

  resetUserPassword(
    userId: string,
    request: AdminPasswordResetRequest,
  ): Observable<ApiActionResponse> {
    return this.http.post<ApiActionResponse>(
      `${this.baseUrl}/users/${userId}/reset-password`,
      request,
    );
  }

  getMenuCatalog(): Observable<ApiDataResponse<MenuCatalogItem[]>> {
    return this.http.get<ApiDataResponse<MenuCatalogItem[]>>(`${this.baseUrl}/menu-catalog`);
  }

  getRolePermissions(roleId: string): Observable<ApiDataResponse<RolePermissionData>> {
    return this.http.get<ApiDataResponse<RolePermissionData>>(
      `${this.baseUrl}/roles/${roleId}/permissions`,
    );
  }

  updateRolePermissions(
    roleId: string,
    request: RolePermissionUpdateRequest,
  ): Observable<ApiMutationResponse<RolePermissionData>> {
    return this.http.put<ApiMutationResponse<RolePermissionData>>(
      `${this.baseUrl}/roles/${roleId}/permissions`,
      request,
    );
  }

  private paginationParams(page: number, size: number): HttpParams {
    return new HttpParams().set('page', page).set('size', size);
  }
}
