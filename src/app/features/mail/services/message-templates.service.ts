import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api.config';
import {
  MessageTemplate,
  MessageTemplateActionResponse,
  MessageTemplateApiResponse,
  MessageTemplateListFilters,
  MessageTemplatePage,
  MessageTemplatePlaceholder,
  MessageTemplatePreview,
  MessageTemplatePreviewRequest,
  MessageTemplateWriteRequest,
} from '../models/message-template.models';

@Injectable({ providedIn: 'root' })
export class MessageTemplatesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${API_CONFIG.baseUrl}/message-templates`;

  list(
    page = 1,
    size = 20,
    filters: MessageTemplateListFilters = {},
  ): Observable<MessageTemplateApiResponse<MessageTemplatePage>> {
    let params = new HttpParams().set('page', page).set('size', size);
    const search = filters.search?.trim();
    if (search) params = params.set('search', search);
    if (filters.includeArchived) params = params.set('include_archived', true);
    return this.http.get<MessageTemplateApiResponse<MessageTemplatePage>>(this.baseUrl, { params });
  }

  placeholders(): Observable<MessageTemplateApiResponse<MessageTemplatePlaceholder[]>> {
    return this.http.get<MessageTemplateApiResponse<MessageTemplatePlaceholder[]>>(
      `${this.baseUrl}/placeholders`,
    );
  }

  get(templateId: string): Observable<MessageTemplateApiResponse<MessageTemplate>> {
    return this.http.get<MessageTemplateApiResponse<MessageTemplate>>(
      `${this.baseUrl}/${templateId}`,
    );
  }

  create(
    request: MessageTemplateWriteRequest,
  ): Observable<MessageTemplateApiResponse<MessageTemplate>> {
    return this.http.post<MessageTemplateApiResponse<MessageTemplate>>(this.baseUrl, request);
  }

  update(
    templateId: string,
    request: MessageTemplateWriteRequest,
  ): Observable<MessageTemplateApiResponse<MessageTemplate>> {
    return this.http.patch<MessageTemplateApiResponse<MessageTemplate>>(
      `${this.baseUrl}/${templateId}`,
      request,
    );
  }

  archive(templateId: string): Observable<MessageTemplateActionResponse> {
    return this.http.delete<MessageTemplateActionResponse>(`${this.baseUrl}/${templateId}`);
  }

  preview(
    templateId: string,
    request: MessageTemplatePreviewRequest = {},
  ): Observable<MessageTemplateApiResponse<MessageTemplatePreview>> {
    return this.http.post<MessageTemplateApiResponse<MessageTemplatePreview>>(
      `${this.baseUrl}/${templateId}/preview`,
      request,
    );
  }
}
