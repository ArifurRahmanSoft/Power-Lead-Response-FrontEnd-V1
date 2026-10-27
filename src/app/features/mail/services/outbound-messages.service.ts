import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api.config';
import {
  ApiDataResponse,
  ApiMessageDataResponse,
  BulkCancelResult,
  BulkConfirmRequest,
  BulkPreviewPage,
  BulkPreviewRequest,
  DirectBatchSendData,
  DirectBatchSendRequest,
  OutboundMessage,
  OutboundMessageListFilters,
  OutboundMessagePage,
  OutboundPreview,
  OutboundPreviewRequest,
  OutboundSendRequest,
} from '../models/outbound-message.models';
import { OutboundMessageContractError } from '../outbound-message-errors';

@Injectable({ providedIn: 'root' })
export class OutboundMessagesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${API_CONFIG.baseUrl}/mail/messages`;
  private readonly batchesUrl = `${API_CONFIG.baseUrl}/mail/batches`;

  preview(request: OutboundPreviewRequest): Observable<ApiDataResponse<OutboundPreview>> {
    return this.http.post<ApiDataResponse<OutboundPreview>>(`${this.baseUrl}/preview`, request);
  }

  send(request: OutboundSendRequest): Observable<ApiDataResponse<OutboundMessage>> {
    return this.http.post<ApiDataResponse<OutboundMessage>>(`${this.baseUrl}/send`, request);
  }

  list(
    page = 1,
    size = 20,
    filters: OutboundMessageListFilters = {},
  ): Observable<ApiDataResponse<OutboundMessagePage>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (filters.leadId) params = params.set('lead_id', filters.leadId);
    if (filters.customerId) params = params.set('customer_id', filters.customerId);
    if (filters.status) params = params.set('status', filters.status);
    return this.http
      .get<ApiDataResponse<OutboundMessagePage>>(this.baseUrl, { params })
      .pipe(map((response) => this.validatePageResponse(response)));
  }

  get(messageId: string): Observable<ApiDataResponse<OutboundMessage>> {
    return this.http.get<ApiDataResponse<OutboundMessage>>(`${this.baseUrl}/${messageId}`);
  }

  cancel(messageId: string, reason: string): Observable<ApiDataResponse<OutboundMessage>> {
    return this.http.post<ApiDataResponse<OutboundMessage>>(`${this.baseUrl}/${messageId}/cancel`, {
      reason,
    });
  }

  previewBatch(request: BulkPreviewRequest): Observable<ApiDataResponse<BulkPreviewPage>> {
    return this.http.post<ApiDataResponse<BulkPreviewPage>>(`${this.batchesUrl}/preview`, request);
  }

  sendBatchDirect(
    request: DirectBatchSendRequest,
  ): Observable<ApiMessageDataResponse<DirectBatchSendData>> {
    return this.http.post<ApiMessageDataResponse<DirectBatchSendData>>(
      `${this.batchesUrl}/send`,
      request,
    );
  }

  confirmBatch(
    batchId: string,
    request: BulkConfirmRequest,
  ): Observable<ApiDataResponse<BulkPreviewPage>> {
    return this.http.post<ApiDataResponse<BulkPreviewPage>>(
      `${this.batchesUrl}/${batchId}/confirm`,
      request,
    );
  }

  getBatch(batchId: string): Observable<ApiDataResponse<BulkPreviewPage>> {
    return this.http.get<ApiDataResponse<BulkPreviewPage>>(`${this.batchesUrl}/${batchId}`);
  }

  getBatchRecipients(
    batchId: string,
    page: number,
    size: number,
  ): Observable<ApiDataResponse<BulkPreviewPage>> {
    return this.http.get<ApiDataResponse<BulkPreviewPage>>(
      `${this.batchesUrl}/${batchId}/recipients`,
      { params: new HttpParams().set('page', page).set('size', size) },
    );
  }

  cancelBatch(batchId: string, reason: string): Observable<ApiDataResponse<BulkCancelResult>> {
    return this.http.post<ApiDataResponse<BulkCancelResult>>(
      `${this.batchesUrl}/${batchId}/cancel`,
      { reason },
    );
  }

  private validatePageResponse(
    response: ApiDataResponse<OutboundMessagePage>,
  ): ApiDataResponse<OutboundMessagePage> {
    const data = response?.data;
    if (
      typeof response?.success !== 'boolean' ||
      !data ||
      !Array.isArray(data.items) ||
      !Number.isInteger(data.page) ||
      !Number.isInteger(data.size) ||
      !Number.isInteger(data.total)
    ) {
      throw new OutboundMessageContractError();
    }
    return response;
  }
}
