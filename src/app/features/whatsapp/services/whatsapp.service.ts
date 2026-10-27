import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api.config';
import {
  ApiDataResponse,
  WhatsAppConversation,
  WhatsAppConversationLinkRequest,
  WhatsAppConversationPage,
  WhatsAppMessagePage,
  WhatsAppReadResult,
  WhatsAppRecoveryResult,
  WhatsAppReplyRequest,
  WhatsAppReplyResult,
} from '../models/whatsapp.models';

@Injectable({ providedIn: 'root' })
export class WhatsAppService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${API_CONFIG.baseUrl}/messages/whatsapp`;

  listConversations(
    page: number,
    size: number,
    search = '',
  ): Observable<ApiDataResponse<WhatsAppConversationPage>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<ApiDataResponse<WhatsAppConversationPage>>(
      `${this.baseUrl}/conversations`,
      {
        params,
      },
    );
  }

  listMessages(
    conversationId: string,
    page: number,
    size: number,
  ): Observable<ApiDataResponse<WhatsAppMessagePage>> {
    return this.http.get<ApiDataResponse<WhatsAppMessagePage>>(
      `${this.baseUrl}/conversations/${conversationId}/messages`,
      { params: new HttpParams().set('page', page).set('size', size) },
    );
  }

  reply(
    conversationId: string,
    request: WhatsAppReplyRequest,
  ): Observable<ApiDataResponse<WhatsAppReplyResult>> {
    return this.http.post<ApiDataResponse<WhatsAppReplyResult>>(
      `${this.baseUrl}/conversations/${conversationId}/reply`,
      request,
    );
  }

  recover(idempotencyKey: string): Observable<ApiDataResponse<WhatsAppRecoveryResult>> {
    return this.http.get<ApiDataResponse<WhatsAppRecoveryResult>>(
      `${this.baseUrl}/operations/recover`,
      { params: new HttpParams().set('idempotency_key', idempotencyKey) },
    );
  }

  markRead(conversationId: string): Observable<ApiDataResponse<WhatsAppReadResult>> {
    return this.http.post<ApiDataResponse<WhatsAppReadResult>>(
      `${this.baseUrl}/conversations/${conversationId}/read`,
      null,
    );
  }

  link(
    conversationId: string,
    request: WhatsAppConversationLinkRequest,
  ): Observable<ApiDataResponse<WhatsAppConversation>> {
    return this.http.put<ApiDataResponse<WhatsAppConversation>>(
      `${this.baseUrl}/conversations/${conversationId}/link`,
      request,
    );
  }
}
