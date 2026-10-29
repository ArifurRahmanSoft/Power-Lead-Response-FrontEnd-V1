export interface MessagingBlockingReason {
  code: string;
  message: string;
}

export interface MessagingEligibilityView {
  reply_allowed: boolean;
  window_expires_at: string | null;
  blocking_reasons: readonly MessagingBlockingReason[];
}

export interface MessagingLinkedRecordView {
  type: 'lead' | 'customer';
  id: string;
  display_name: string;
}

export interface MessagingConversationView {
  id: string;
  contact_display_name: string;
  display_name_available: boolean;
  contact_display_name_source: 'linked_record' | 'provider_profile' | 'fallback';
  account_display_name?: string;
  page_display_name?: string;
  lead_id: string | null;
  customer_id: string | null;
  linked_record: MessagingLinkedRecordView | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_inbound_at: string | null;
  unread_count: number;
  eligibility: MessagingEligibilityView;
}

export interface MessagingChannelView {
  id: string;
  account_display_name?: string;
  page_display_name?: string;
  display_name_available?: boolean;
  active: boolean;
}

export interface MessagingMessageView {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  actor_type: string;
  actor_user_id: string | null;
  body: string;
  media: readonly { type: string; unsupported: boolean }[];
  status: string;
  provider_message_id: string | null;
  failure_reason: string | null;
  occurred_at: string;
}
