export const INSTAGRAM_REPLY_MAX_CHARACTERS = 1_000;
export const INSTAGRAM_REPLY_MAX_UTF8_BYTES = 1_000;
export const INSTAGRAM_CONVERSATION_PAGE_SIZE = 20;
export const INSTAGRAM_MESSAGE_PAGE_SIZE = 50;

export interface InstagramApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface InstagramChannel {
  id: string;
  provider: 'instagram';
  account_id: string;
  account_display_name: string;
  configuration_id: string | null;
  ready: boolean;
  active: boolean;
}

export interface InstagramBlockingReason {
  code: string;
  message: string;
}

export interface InstagramEligibility {
  reply_allowed: boolean;
  window_expires_at: string | null;
  blocking_reasons: readonly InstagramBlockingReason[];
}

export interface InstagramLinkedRecord {
  type: 'lead' | 'customer';
  id: string;
  display_name: string;
}

export interface InstagramConversation {
  id: string;
  igsid: string;
  contact_display_name: string;
  display_name_available: boolean;
  contact_display_name_source: 'linked_record' | 'provider_profile' | 'fallback';
  account_display_name: string;
  lead_id: string | null;
  customer_id: string | null;
  linked_record: InstagramLinkedRecord | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_inbound_at: string | null;
  unread_count: number;
  eligibility: InstagramEligibility;
}

export interface InstagramConversationPage {
  items: InstagramConversation[];
  page: number;
  size: number;
  total: number;
  pages: number;
}

export interface InstagramMediaMetadata {
  type: 'audio' | 'file' | 'image' | 'video' | 'media' | 'ig_post' | 'story' | 'attachment';
  unsupported: boolean;
}

export type InstagramMessageStatus = 'received' | 'accepted' | 'read' | 'failed' | 'unknown';

export interface InstagramMessage {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  provider: 'instagram';
  source: 'contact' | 'crm' | 'instagram_inbox';
  actor_type: 'contact' | 'crm_user' | 'instagram_account';
  actor_user_id: string | null;
  body: string;
  media: InstagramMediaMetadata[];
  status: InstagramMessageStatus;
  provider_message_id: string | null;
  provider_error_code: string | null;
  failure_reason: string | null;
  requested_by_user_id: string | null;
  occurred_at: string;
  completed_at: string | null;
}

export interface InstagramMessagePage {
  conversation: InstagramConversation;
  items: InstagramMessage[];
  page: number;
  size: number;
  total: number;
  pages: number;
}

export interface InstagramReplyRequest {
  text: string;
  idempotency_key: string;
}

export interface InstagramReplyResult {
  message: InstagramMessage;
  replayed: boolean;
  operation_state: 'in_progress' | 'completed';
}

export interface InstagramRecoveryResult {
  idempotency_key: string;
  found: boolean;
  operation_state: 'missing' | 'in_progress' | 'completed';
  message: InstagramMessage | null;
}

export interface InstagramReadResult {
  conversation_id: string;
  unread_count: 0;
  last_read_at: string;
  provider_receipt_sent: false;
}

export interface InstagramConversationLinkRequest {
  lead_id?: string;
  customer_id?: string;
}

export interface PendingInstagramReply {
  channelId: string;
  conversationId: string;
  contextKey: string;
  textSnapshot: string;
  request: Readonly<InstagramReplyRequest>;
  messageId?: string;
}

export function instagramReplyUtf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function instagramReplyIsValid(text: string): boolean {
  return (
    Boolean(text.trim()) &&
    !text.includes('\0') &&
    text.length <= INSTAGRAM_REPLY_MAX_CHARACTERS &&
    instagramReplyUtf8Bytes(text) <= INSTAGRAM_REPLY_MAX_UTF8_BYTES
  );
}
