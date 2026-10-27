import { ContactStage } from '../../mail/models/outbound-message.models';

export const SMS_DIRECT_SEND_MAX_RECIPIENTS = 10;

export type SmsRecipientStatus =
  'accepted' | 'queued' | 'sent' | 'delivered' | 'failed' | 'undelivered' | 'unknown' | 'skipped';

export interface SmsRecipientInput {
  id: string;
  name: string;
  phone: string | null;
}

export interface SmsSendRequest {
  lead_ids: string[];
  message_template_id: string;
  contact_type: ContactStage;
  idempotency_key: string;
}

export interface SmsRecipientResult {
  requested_lead_id: string;
  lead_id: string | null;
  message_id: string | null;
  status: SmsRecipientStatus | string;
  provider_message_sid: string | null;
  reason_code: string | null;
  reason: string | null;
  warnings: string[];
}

export interface SmsBatchData {
  batch_id: string;
  status: string;
  selection_count: number;
  contact_type: ContactStage;
  accepted_count: number;
  queued_count: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  undelivered_count: number;
  unknown_count: number;
  skipped_count: number;
  replayed: boolean;
  recipients: SmsRecipientResult[];
}

export interface SmsBatchResponse {
  success: boolean;
  message: string;
  data: SmsBatchData;
}

export type SmsRecoveryState = 'missing' | 'in_progress' | 'completed';

export interface SmsRecoveryData {
  idempotency_key: string;
  found: boolean;
  operation_state: SmsRecoveryState;
  batch: SmsBatchData | null;
}

export interface SmsRecoveryResponse {
  success: boolean;
  message: string;
  data: SmsRecoveryData;
}

export interface SmsMessageEvent {
  status: string;
  provider_error_code: string | null;
  safe_reason: string | null;
  occurred_at: string;
}

export interface SmsMessage {
  id: string;
  batch_id: string;
  lead_id: string;
  message_template_id: string;
  template_updated_at: string;
  contact_type: ContactStage;
  recipient_phone: string | null;
  rendered_body: string;
  status: SmsRecipientStatus | string;
  provider_message_sid: string | null;
  provider_error_code: string | null;
  failure_reason: string | null;
  requested_by_user_id: string;
  attempted_at: string | null;
  accepted_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  last_status_checked_at: string | null;
  created_at: string;
  updated_at: string;
  events: SmsMessageEvent[];
}

export interface SmsMessageResponse {
  success: boolean;
  message?: string | null;
  refreshed?: boolean | null;
  next_refresh_at?: string | null;
  data: SmsMessage;
}
