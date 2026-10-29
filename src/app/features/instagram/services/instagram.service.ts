import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api.config';
import {
  InstagramApiResponse,
  InstagramChannel,
  InstagramConversation,
  InstagramConversationLinkRequest,
  InstagramConversationPage,
  InstagramMessagePage,
  InstagramReadResult,
  InstagramRecoveryResult,
  InstagramReplyRequest,
  InstagramReplyResult,
} from '../models/instagram.models';

const INSTAGRAM_API_PATH = 'messages/meta/instagram';

export function instagramApiRoot(apiBaseUrl = API_CONFIG.baseUrl): string {
  const normalizedBase = apiBaseUrl.trim().replace(/\/+$/, '');
  const parsedBase = new URL(normalizedBase);
  if (parsedBase.pathname.toLowerCase().includes('/webhooks/')) {
    throw new Error('A provider webhook URL cannot be used as the frontend API base.');
  }
  return `${normalizedBase}/${INSTAGRAM_API_PATH}`;
}

@Injectable({ providedIn: 'root' })
export class InstagramService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = instagramApiRoot();

  getChannel(): Observable<InstagramApiResponse<InstagramChannel>> {
    return this.http.get<InstagramApiResponse<InstagramChannel>>(`${this.baseUrl}/channel`);
  }

  listConversations(
    page: number,
    size: number,
    search = '',
  ): Observable<InstagramApiResponse<InstagramConversationPage>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<InstagramApiResponse<InstagramConversationPage>>(
      `${this.baseUrl}/conversations`,
      { params },
    );
  }

  listMessages(
    conversationId: string,
    page: number,
    size: number,
  ): Observable<InstagramApiResponse<InstagramMessagePage>> {
    return this.http.get<InstagramApiResponse<InstagramMessagePage>>(
      `${this.baseUrl}/conversations/${conversationId}/messages`,
      { params: new HttpParams().set('page', page).set('size', size) },
    );
  }

  reply(
    conversationId: string,
    request: Readonly<InstagramReplyRequest>,
  ): Observable<InstagramApiResponse<InstagramReplyResult>> {
    return this.http.post<InstagramApiResponse<InstagramReplyResult>>(
      `${this.baseUrl}/conversations/${conversationId}/reply`,
      request,
    );
  }

  recover(idempotencyKey: string): Observable<InstagramApiResponse<InstagramRecoveryResult>> {
    return this.http.get<InstagramApiResponse<InstagramRecoveryResult>>(
      `${this.baseUrl}/operations/recover`,
      { params: new HttpParams().set('idempotency_key', idempotencyKey) },
    );
  }

  markRead(conversationId: string): Observable<InstagramApiResponse<InstagramReadResult>> {
    return this.http.post<InstagramApiResponse<InstagramReadResult>>(
      `${this.baseUrl}/conversations/${conversationId}/read`,
      null,
    );
  }

  link(
    conversationId: string,
    request: InstagramConversationLinkRequest,
  ): Observable<InstagramApiResponse<InstagramConversation>> {
    return this.http.put<InstagramApiResponse<InstagramConversation>>(
      `${this.baseUrl}/conversations/${conversationId}/link`,
      request,
    );
  }
}
