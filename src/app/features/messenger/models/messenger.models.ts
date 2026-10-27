export const MESSENGER_REPLY_MAX_CHARACTERS = 2000;
export const MESSENGER_CONVERSATION_PAGE_SIZE = 20;
export const MESSENGER_MESSAGE_PAGE_SIZE = 50;

export interface MessengerApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface MessengerChannel {
  id: string;
  provider: 'messenger';
  page_id: string;
  page_display_name: string;
  display_name_available: boolean;
  profile_refreshed_at: string | null;
  active: boolean;
}

export interface MessengerBlockingReason {
  code: string;
  message: string;
}

export interface MessengerEligibility {
  reply_allowed: boolean;
  window_expires_at: string | null;
  blocking_reasons: readonly MessengerBlockingReason[];
}

export interface MessengerLinkedRecord {
  type: 'lead' | 'customer';
  id: string;
  display_name: string;
}

export interface MessengerConversation {
  id: string;
  psid: string;
  contact_display_name: string;
  display_name_available: boolean;
  contact_display_name_source: 'linked_record' | 'provider_profile' | 'fallback';
  page_display_name: string;
  lead_id: string | null;
  customer_id: string | null;
  linked_record: MessengerLinkedRecord | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_inbound_at: string | null;
  unread_count: number;
  eligibility: MessengerEligibility;
}

export interface MessengerConversationPage {
  items: MessengerConversation[];
  page: number;
  size: number;
  total: number;
  pages: number;
}

export interface MessengerMediaMetadata {
  type: string;
  unsupported: boolean;
}

export type MessengerMessageDirection = 'inbound' | 'outbound';
export type MessengerMessageSource = 'contact' | 'crm' | 'page_inbox';

export interface MessengerMessage {
  id: string;
  conversation_id: string;
  direction: MessengerMessageDirection;
  provider: 'messenger';
  source: MessengerMessageSource;
  actor_type: 'contact' | 'crm_user' | 'page';
  actor_user_id: string | null;
  body: string;
  media: MessengerMediaMetadata[];
  status: string;
  provider_message_id: string | null;
  provider_error_code: string | null;
  failure_reason: string | null;
  requested_by_user_id: string | null;
  occurred_at: string;
  completed_at: string | null;
}

export interface MessengerMessagePage {
  conversation: MessengerConversation;
  items: MessengerMessage[];
  page: number;
  size: number;
  total: number;
  pages: number;
}

export interface MessengerReplyRequest {
  text: string;
  idempotency_key: string;
}

export interface MessengerReplyResult {
  message: MessengerMessage;
  replayed: boolean;
  operation_state: 'in_progress' | 'completed';
}

export interface MessengerRecoveryResult {
  idempotency_key: string;
  found: boolean;
  operation_state: 'missing' | 'in_progress' | 'completed';
  message: MessengerMessage | null;
}

export interface MessengerReadResult {
  conversation_id: string;
  unread_count: number;
  last_read_at: string;
}

export interface MessengerConversationLinkRequest {
  lead_id?: string;
  customer_id?: string;
}

export interface MessengerProfileRefreshRequest {
  conversation_ids: string[];
  refresh_page: boolean;
}

export interface MessengerProfileRefreshItem {
  conversation_id: string;
  status: 'refreshed' | 'cached' | 'unavailable';
  contact_display_name: string;
  display_name_available: boolean;
  reason_code: string | null;
}

export interface MessengerProfileRefreshResult {
  page_display_name: string;
  page_status: 'refreshed' | 'cached' | 'unavailable' | 'skipped';
  items: MessengerProfileRefreshItem[];
  requested_count: number;
  refreshed_count: number;
  unavailable_count: number;
}

export interface PendingMessengerReply {
  channelId: string;
  conversationId: string;
  contextKey: string;
  textSnapshot: string;
  request: Readonly<MessengerReplyRequest>;
  messageId?: string;
}
