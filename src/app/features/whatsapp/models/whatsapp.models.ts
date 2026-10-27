export const WHATSAPP_MESSAGE_STATUSES = [
  'accepted',
  'queued',
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
  'undelivered',
  'unknown',
] as const;

export type WhatsAppMessageStatus = (typeof WHATSAPP_MESSAGE_STATUSES)[number];
export type WhatsAppMessageDirection = 'inbound' | 'outbound';
export type WhatsAppOperationState = 'missing' | 'in_progress' | 'completed' | string;
export type WhatsAppProvider = 'twilio' | 'meta';

export const WHATSAPP_REPLY_MAX_CHARACTERS = 1600;
export const WHATSAPP_CONVERSATION_PAGE_SIZE = 20;
export const WHATSAPP_MESSAGE_PAGE_SIZE = 50;

export interface WhatsAppConversation {
  id: string;
  external_address: string;
  lead_id: string | null;
  customer_id: string | null;
  contact_name: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  unread_count: number;
  free_form_reply_allowed: boolean;
  service_window_expires_at: string | null;
  provider?: WhatsAppProvider;
  eligibility?: WhatsAppEligibility;
}

export interface WhatsAppEligibility {
  free_form_allowed: boolean;
  service_window_expires_at: string | null;
  approved_template_required: boolean;
  template_outreach_allowed: boolean;
  restrictions: readonly WhatsAppRestriction[];
}

export interface WhatsAppRestriction {
  code?: string;
  message?: string;
  [key: string]: string | undefined;
}

export interface WhatsAppChannelOption {
  provider: WhatsAppProvider;
  id: string;
  label: string;
  senderAddress: string | null;
  accountId: string | null;
  channelId: string | null;
}

export interface WhatsAppConversationPage {
  items: WhatsAppConversation[];
  page: number;
  size: number;
  total: number;
  pages: number;
}

export interface WhatsAppMediaMetadata {
  index: number;
  content_type: string | null;
  unsupported: boolean;
}

export interface WhatsAppMessage {
  id: string;
  conversation_id: string;
  direction: WhatsAppMessageDirection;
  body: string;
  media: WhatsAppMediaMetadata[];
  status: WhatsAppMessageStatus;
  provider_message_sid: string | null;
  provider_error_code: string | null;
  failure_reason: string | null;
  requested_by_user_id: string | null;
  occurred_at: string;
  completed_at: string | null;
  provider?: WhatsAppProvider;
  mode?: string;
  purpose?: string | null;
  provider_message_id?: string | null;
}

export interface WhatsAppMessagePage {
  conversation: WhatsAppConversation;
  items: WhatsAppMessage[];
  page: number;
  size: number;
  total: number;
  pages: number;
}

export interface ApiDataResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface WhatsAppReplyRequest {
  body: string;
  idempotency_key: string;
}

export interface WhatsAppReplyResult {
  message: WhatsAppMessage;
  replayed: boolean;
  operation_state: WhatsAppOperationState;
}

export interface WhatsAppRecoveryResult {
  idempotency_key: string;
  found: boolean;
  operation_state: WhatsAppOperationState;
  message: WhatsAppMessage | null;
}

export interface WhatsAppReadResult {
  conversation_id: string;
  unread_count: number;
  last_read_at: string;
}

export interface WhatsAppConversationLinkRequest {
  lead_id?: string;
  customer_id?: string;
}

export interface PendingWhatsAppReply {
  conversationId: string;
  request: Readonly<WhatsAppReplyRequest>;
}
