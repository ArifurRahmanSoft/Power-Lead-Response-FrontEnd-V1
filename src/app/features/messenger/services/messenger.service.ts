import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api.config';
import {
  MessengerApiResponse,
  MessengerChannel,
  MessengerConversation,
  MessengerConversationLinkRequest,
  MessengerConversationPage,
  MessengerMessagePage,
  MessengerProfileRefreshRequest,
  MessengerProfileRefreshResult,
  MessengerReadResult,
  MessengerRecoveryResult,
  MessengerReplyRequest,
  MessengerReplyResult,
} from '../models/messenger.models';

const MESSENGER_API_PATH = 'messages/meta/messenger';

export function messengerApiRoot(apiBaseUrl = API_CONFIG.baseUrl): string {
  const normalizedBase = apiBaseUrl.trim().replace(/\/+$/, '');
  const parsedBase = new URL(normalizedBase);
  if (parsedBase.pathname.toLowerCase().includes('/webhooks/')) {
    throw new Error('A provider webhook URL cannot be used as the frontend API base.');
  }
  return `${normalizedBase}/${MESSENGER_API_PATH}`;
}

@Injectable({ providedIn: 'root' })
export class MessengerService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = messengerApiRoot();

  getChannel(): Observable<MessengerApiResponse<MessengerChannel>> {
    return this.http.get<MessengerApiResponse<MessengerChannel>>(`${this.baseUrl}/channel`);
  }

  refreshProfiles(
    request: Readonly<MessengerProfileRefreshRequest>,
  ): Observable<MessengerApiResponse<MessengerProfileRefreshResult>> {
    return this.http.post<MessengerApiResponse<MessengerProfileRefreshResult>>(
      `${this.baseUrl}/profiles/refresh`,
      request,
    );
  }

  listConversations(
    page: number,
    size: number,
    search = '',
  ): Observable<MessengerApiResponse<MessengerConversationPage>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<MessengerApiResponse<MessengerConversationPage>>(
      `${this.baseUrl}/conversations`,
      { params },
    );
  }

  listMessages(
    conversationId: string,
    page: number,
    size: number,
  ): Observable<MessengerApiResponse<MessengerMessagePage>> {
    return this.http.get<MessengerApiResponse<MessengerMessagePage>>(
      `${this.baseUrl}/conversations/${conversationId}/messages`,
      { params: new HttpParams().set('page', page).set('size', size) },
    );
  }

  reply(
    conversationId: string,
    request: Readonly<MessengerReplyRequest>,
  ): Observable<MessengerApiResponse<MessengerReplyResult>> {
    return this.http.post<MessengerApiResponse<MessengerReplyResult>>(
      `${this.baseUrl}/conversations/${conversationId}/reply`,
      request,
    );
  }

  recover(idempotencyKey: string): Observable<MessengerApiResponse<MessengerRecoveryResult>> {
    return this.http.get<MessengerApiResponse<MessengerRecoveryResult>>(
      `${this.baseUrl}/operations/recover`,
      { params: new HttpParams().set('idempotency_key', idempotencyKey) },
    );
  }

  markRead(conversationId: string): Observable<MessengerApiResponse<MessengerReadResult>> {
    return this.http.post<MessengerApiResponse<MessengerReadResult>>(
      `${this.baseUrl}/conversations/${conversationId}/read`,
      null,
    );
  }

  link(
    conversationId: string,
    request: MessengerConversationLinkRequest,
  ): Observable<MessengerApiResponse<MessengerConversation>> {
    return this.http.put<MessengerApiResponse<MessengerConversation>>(
      `${this.baseUrl}/conversations/${conversationId}/link`,
      request,
    );
  }
}
