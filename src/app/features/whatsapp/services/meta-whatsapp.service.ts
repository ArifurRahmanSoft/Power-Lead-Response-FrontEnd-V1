import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api.config';
import {
  MetaApprovedTemplatePage,
  MetaChannelResponse,
  MetaWhatsAppConnectCompleteRequest,
  MetaWhatsAppConnectInitiationResponse,
  MetaWhatsAppConnectOperationResponse,
  MetaWhatsAppConnectReadinessResponse,
  MetaWhatsAppConversation,
  MetaWhatsAppConversationPage,
  MetaWhatsAppLinkRequest,
  MetaWhatsAppMessagePage,
  MetaWhatsAppOpenRequest,
  MetaWhatsAppReadResult,
  MetaWhatsAppRecoveryResult,
  MetaWhatsAppSendRequest,
  MetaWhatsAppSendResult,
} from '../models/meta-whatsapp.models';
import { ApiDataResponse } from '../models/whatsapp.models';

const META_WHATSAPP_API_PATH = 'messages/meta/whatsapp';

export function metaWhatsAppApiRoot(apiBaseUrl = API_CONFIG.baseUrl): string {
  const normalizedBase = apiBaseUrl.trim().replace(/\/+$/, '');
  const parsedBase = new URL(normalizedBase);
  if (parsedBase.pathname.toLowerCase().includes('/webhooks/')) {
    throw new Error('A provider webhook URL cannot be used as the frontend API base.');
  }
  return `${normalizedBase}/${META_WHATSAPP_API_PATH}`;
}

@Injectable({ providedIn: 'root' })
export class MetaWhatsAppService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = metaWhatsAppApiRoot();
  private readonly channelChangedSubject = new Subject<void>();
  readonly channelChanged$ = this.channelChangedSubject.asObservable();

  announceChannelChanged(): void {
    this.channelChangedSubject.next();
  }

  getChannel(): Observable<MetaChannelResponse> {
    return this.http.get<MetaChannelResponse>(`${this.baseUrl}/channel`);
  }

  getConnectReadiness(): Observable<MetaWhatsAppConnectReadinessResponse> {
    return this.http.get<MetaWhatsAppConnectReadinessResponse>(`${this.baseUrl}/connect/readiness`);
  }

  initiateConnection(): Observable<MetaWhatsAppConnectInitiationResponse> {
    return this.http.post<MetaWhatsAppConnectInitiationResponse>(
      `${this.baseUrl}/connect/initiate`,
      null,
    );
  }

  completeConnection(
    request: Readonly<MetaWhatsAppConnectCompleteRequest>,
  ): Observable<MetaWhatsAppConnectOperationResponse> {
    return this.http.post<MetaWhatsAppConnectOperationResponse>(
      `${this.baseUrl}/connect/complete`,
      request,
    );
  }

  getConnectionOperation(operationId: string): Observable<MetaWhatsAppConnectOperationResponse> {
    return this.http.get<MetaWhatsAppConnectOperationResponse>(
      `${this.baseUrl}/connect/operations/${encodeURIComponent(operationId)}`,
    );
  }

  activateConnection(operationId: string): Observable<MetaWhatsAppConnectOperationResponse> {
    return this.http.post<MetaWhatsAppConnectOperationResponse>(
      `${this.baseUrl}/connect/operations/${encodeURIComponent(operationId)}/activate`,
      { confirm_replace_existing_sender: true },
    );
  }

  listConversations(
    page: number,
    size: number,
    search = '',
  ): Observable<ApiDataResponse<MetaWhatsAppConversationPage>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<ApiDataResponse<MetaWhatsAppConversationPage>>(
      `${this.baseUrl}/conversations`,
      { params },
    );
  }

  openConversation(
    request: MetaWhatsAppOpenRequest,
  ): Observable<ApiDataResponse<MetaWhatsAppConversation>> {
    return this.http.post<ApiDataResponse<MetaWhatsAppConversation>>(
      `${this.baseUrl}/conversations/open`,
      request,
    );
  }

  listMessages(
    conversationId: string,
    page: number,
    size: number,
  ): Observable<ApiDataResponse<MetaWhatsAppMessagePage>> {
    return this.http.get<ApiDataResponse<MetaWhatsAppMessagePage>>(
      `${this.baseUrl}/conversations/${conversationId}/messages`,
      { params: new HttpParams().set('page', page).set('size', size) },
    );
  }

  listTemplates(
    page: number,
    size: number,
    search = '',
  ): Observable<ApiDataResponse<MetaApprovedTemplatePage>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<ApiDataResponse<MetaApprovedTemplatePage>>(`${this.baseUrl}/templates`, {
      params,
    });
  }

  send(
    request: Readonly<MetaWhatsAppSendRequest>,
  ): Observable<ApiDataResponse<MetaWhatsAppSendResult>> {
    return this.http.post<ApiDataResponse<MetaWhatsAppSendResult>>(`${this.baseUrl}/send`, request);
  }

  recover(idempotencyKey: string): Observable<ApiDataResponse<MetaWhatsAppRecoveryResult>> {
    return this.http.get<ApiDataResponse<MetaWhatsAppRecoveryResult>>(
      `${this.baseUrl}/operations/recover`,
      { params: new HttpParams().set('idempotency_key', idempotencyKey) },
    );
  }

  markRead(conversationId: string): Observable<ApiDataResponse<MetaWhatsAppReadResult>> {
    return this.http.post<ApiDataResponse<MetaWhatsAppReadResult>>(
      `${this.baseUrl}/conversations/${conversationId}/read`,
      null,
    );
  }

  link(
    conversationId: string,
    request: MetaWhatsAppLinkRequest,
  ): Observable<ApiDataResponse<MetaWhatsAppConversation>> {
    return this.http.put<ApiDataResponse<MetaWhatsAppConversation>>(
      `${this.baseUrl}/conversations/${conversationId}/link`,
      request,
    );
  }
}
