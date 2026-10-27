import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api.config';
import {
  ApiActionResponse,
  ApiDataResponse,
  SenderAccount,
  SenderAccountCreateRequest,
  SenderAccountListData,
  SenderAccountUpdateRequest,
  SenderConnectionTestResponse,
} from '../models/sender-account.models';

@Injectable({ providedIn: 'root' })
export class SenderAccountsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${API_CONFIG.baseUrl}/mail/sender-accounts`;

  list(
    page = 1,
    size = 20,
    includeInactive = true,
  ): Observable<ApiDataResponse<SenderAccountListData>> {
    const params = new HttpParams()
      .set('page', page)
      .set('size', size)
      .set('include_inactive', includeInactive);
    return this.http.get<ApiDataResponse<SenderAccountListData>>(this.baseUrl, { params });
  }

  create(request: SenderAccountCreateRequest): Observable<ApiDataResponse<SenderAccount>> {
    return this.http.post<ApiDataResponse<SenderAccount>>(this.baseUrl, request);
  }

  update(
    accountId: string,
    request: SenderAccountUpdateRequest,
  ): Observable<ApiDataResponse<SenderAccount>> {
    return this.http.patch<ApiDataResponse<SenderAccount>>(`${this.baseUrl}/${accountId}`, request);
  }

  deactivate(accountId: string): Observable<ApiDataResponse<SenderAccount>> {
    return this.http.post<ApiDataResponse<SenderAccount>>(
      `${this.baseUrl}/${accountId}/deactivate`,
      {},
    );
  }

  delete(accountId: string): Observable<ApiActionResponse> {
    return this.http.delete<ApiActionResponse>(`${this.baseUrl}/${accountId}`);
  }

  setDefault(accountId: string): Observable<ApiDataResponse<SenderAccount>> {
    return this.http.post<ApiDataResponse<SenderAccount>>(
      `${this.baseUrl}/${accountId}/set-default`,
      {},
    );
  }

  testConnection(accountId: string): Observable<SenderConnectionTestResponse> {
    return this.http.post<SenderConnectionTestResponse>(
      `${this.baseUrl}/${accountId}/test-connection`,
      {},
    );
  }

  sendTestEmail(accountId: string, recipient: string): Observable<ApiActionResponse> {
    return this.http.post<ApiActionResponse>(`${this.baseUrl}/${accountId}/test-email`, {
      recipient,
    });
  }
}
