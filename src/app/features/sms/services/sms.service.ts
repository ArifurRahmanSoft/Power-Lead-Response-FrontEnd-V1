import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api.config';
import {
  SmsBatchResponse,
  SmsMessageResponse,
  SmsRecoveryResponse,
  SmsSendRequest,
} from '../models/sms.models';

@Injectable({ providedIn: 'root' })
export class SmsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${API_CONFIG.baseUrl}/sms`;

  send(request: SmsSendRequest): Observable<SmsBatchResponse> {
    return this.http.post<SmsBatchResponse>(`${this.baseUrl}/send`, request);
  }

  recover(idempotencyKey: string): Observable<SmsRecoveryResponse> {
    const params = new HttpParams().set('idempotency_key', idempotencyKey);
    return this.http.get<SmsRecoveryResponse>(`${this.baseUrl}/operations/recover`, { params });
  }

  getBatch(batchId: string): Observable<SmsBatchResponse> {
    return this.http.get<SmsBatchResponse>(`${this.baseUrl}/batches/${batchId}`);
  }

  refreshStatus(messageId: string): Observable<SmsMessageResponse> {
    return this.http.post<SmsMessageResponse>(
      `${this.baseUrl}/messages/${messageId}/refresh-status`,
      null,
    );
  }
}
