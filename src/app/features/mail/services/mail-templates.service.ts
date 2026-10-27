import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api.config';
import {
  ApiActionResponse,
  ApiDataResponse,
  MailTemplate,
  MailTemplateAsset,
  MailTemplateAssetKind,
  MailTemplateCreateRequest,
  MailTemplateListData,
  MailTemplateListFilters,
  MailTemplatePreview,
  MailTemplatePreviewRequest,
  MailTemplateUpdateRequest,
  PlaceholderDefinition,
} from '../models/mail-template.models';

@Injectable({ providedIn: 'root' })
export class MailTemplatesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${API_CONFIG.baseUrl}/mail/templates`;

  list(
    page = 1,
    size = 20,
    filters: MailTemplateListFilters = {},
  ): Observable<ApiDataResponse<MailTemplateListData>> {
    let params = new HttpParams().set('page', page).set('size', size);
    const search = filters.search?.trim();
    if (search) params = params.set('search', search);
    if (filters.enabled !== undefined) params = params.set('enabled', filters.enabled);
    if (filters.approvalStatus) params = params.set('approval_status', filters.approvalStatus);
    if (filters.includeArchived) params = params.set('include_archived', true);
    return this.http.get<ApiDataResponse<MailTemplateListData>>(this.baseUrl, { params });
  }

  placeholders(): Observable<ApiDataResponse<PlaceholderDefinition[]>> {
    return this.http.get<ApiDataResponse<PlaceholderDefinition[]>>(`${this.baseUrl}/placeholders`);
  }

  get(templateId: string, version?: number): Observable<ApiDataResponse<MailTemplate>> {
    const params = version ? new HttpParams().set('version', version) : undefined;
    return this.http.get<ApiDataResponse<MailTemplate>>(`${this.baseUrl}/${templateId}`, {
      params,
    });
  }

  create(request: MailTemplateCreateRequest): Observable<ApiDataResponse<MailTemplate>> {
    return this.http.post<ApiDataResponse<MailTemplate>>(this.baseUrl, request);
  }

  update(
    templateId: string,
    request: MailTemplateUpdateRequest,
  ): Observable<ApiDataResponse<MailTemplate>> {
    return this.http.patch<ApiDataResponse<MailTemplate>>(`${this.baseUrl}/${templateId}`, request);
  }

  archive(templateId: string): Observable<ApiActionResponse> {
    return this.http.delete<ApiActionResponse>(`${this.baseUrl}/${templateId}`);
  }

  approve(templateId: string): Observable<ApiDataResponse<MailTemplate>> {
    return this.http.post<ApiDataResponse<MailTemplate>>(
      `${this.baseUrl}/${templateId}/approve`,
      {},
    );
  }

  preview(
    templateId: string,
    request: MailTemplatePreviewRequest,
  ): Observable<ApiDataResponse<MailTemplatePreview>> {
    return this.http.post<ApiDataResponse<MailTemplatePreview>>(
      `${this.baseUrl}/${templateId}/preview`,
      request,
    );
  }

  uploadAsset(
    templateId: string,
    kind: MailTemplateAssetKind,
    file: File,
  ): Observable<HttpEvent<ApiDataResponse<MailTemplateAsset>>> {
    const body = new FormData();
    body.append('kind', kind);
    body.append('file', file, file.name);
    return this.http.post<ApiDataResponse<MailTemplateAsset>>(
      `${this.baseUrl}/${templateId}/assets`,
      body,
      { observe: 'events', reportProgress: true },
    );
  }

  assetContent(contentUrl: string): Observable<Blob> {
    const url = contentUrl.startsWith('http')
      ? contentUrl
      : `${API_CONFIG.baseUrl}${contentUrl.replace(/^\/api/, '')}`;
    return this.http.get(url, { responseType: 'blob' });
  }

  removeAsset(templateId: string, assetId: string): Observable<ApiActionResponse> {
    return this.http.delete<ApiActionResponse>(`${this.baseUrl}/${templateId}/assets/${assetId}`);
  }
}
