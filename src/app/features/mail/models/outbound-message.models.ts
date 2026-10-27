export type MailContextType = 'lead' | 'customer';
export type CommunicationPurpose = 'lead_acquisition' | 'customer_service';
export type OutboundMessageStatus =
  'queued' | 'processing' | 'sent' | 'failed' | 'unknown' | 'cancelled';
export type ContactStage = 'initial' | 'follow_up' | 'second_follow_up' | 'final_follow_up';
export type BulkSelectionMode = 'selected' | 'all_matching';

export interface OutboundSenderSnapshot {
  display_name: string;
  sender_email: string;
  reply_to: string | null;
}

export interface OutboundPreviewRequest {
  context_type: MailContextType;
  context_id: string;
  sender_account_id: string;
  template_id: string;
  template_version: number;
  purpose: CommunicationPurpose;
}

export interface OutboundPreview {
  preview_id: string;
  preview_hash: string;
  expires_at: string;
  context_type: MailContextType;
  context_id: string;
  recipient: string;
  purpose: CommunicationPurpose;
  sender: OutboundSenderSnapshot;
  template_id: string;
  template_version: number;
  subject: string;
  body_html: string;
  body_text: string;
  attachment_count: number;
  inline_asset_count: number;
}

export interface OutboundSendRequest {
  preview_id: string;
  preview_hash: string;
  idempotency_key: string;
}

export interface OutboundMessageEvent {
  status: string;
  safe_reason: string | null;
  occurred_at: string;
}

export interface OutboundMessage {
  id: string;
  job_id: string | null;
  context_type: MailContextType;
  lead_id: string | null;
  customer_id: string | null;
  purpose: CommunicationPurpose;
  batch_id?: string | null;
  contact_stage?: ContactStage;
  recipient_email: string;
  sender: OutboundSenderSnapshot;
  template_id: string;
  template_version: number;
  subject: string;
  status: OutboundMessageStatus;
  created_at: string;
  processing_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  failure_reason: string | null;
  events: OutboundMessageEvent[];
}

export interface BulkPreviewRequest {
  selection_mode: BulkSelectionMode;
  lead_ids?: string[];
  filters?: Record<string, string>;
  sender_account_id: string;
  template_id: string;
  template_version: number;
  contact_stage: ContactStage;
  page: number;
  size: number;
}

export interface DirectBatchSendRequest {
  selection_mode: BulkSelectionMode;
  lead_ids?: string[];
  filters?: Record<string, string>;
  sender_account_id: string;
  template_id: string;
  template_version: number;
  contact_type: ContactStage;
  supersede_queued?: boolean;
  idempotency_key: string;
}

export interface DirectBatchRecipient {
  requested_lead_id: string;
  lead_id: string | null;
  message_id: string | null;
  status: string;
  skip_code: string | null;
  skip_reason: string | null;
  warnings: string[];
}

export interface DirectBatchSendData {
  batch_id: string;
  status: string;
  selection_count: number;
  queued_count: number;
  processing_count: number;
  sent_count: number;
  failed_count: number;
  unknown_count: number;
  skipped_count: number;
  pending_worker_job_count: number;
  contact_type: ContactStage;
  replayed: boolean;
  recipients: DirectBatchRecipient[];
}

export interface BulkRecipient {
  id: string;
  lead_id: string | null;
  requested_lead_id: string;
  recipient_email: string | null;
  preview_status: string;
  exclusion_code: string | null;
  exclusion_reason: string | null;
  warnings: string[];
  preview_id: string | null;
  message_id: string | null;
  message_status: OutboundMessageStatus | null;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  events: OutboundMessageEvent[];
}

export type BulkBatchStatus =
  'previewed' | 'queued' | 'processing' | 'completed' | 'partially_completed' | 'cancelled';

export interface BulkBatch {
  id: string;
  status: BulkBatchStatus;
  selection_mode: BulkSelectionMode;
  selection_count: number;
  eligible_count: number;
  blocked_count: number;
  preview_hash: string;
  expires_at: string;
  sender: OutboundSenderSnapshot;
  template_id: string;
  template_version: number;
  contact_stage: ContactStage;
  queued_count: number;
  processing_count: number;
  sent_count: number;
  failed_count: number;
  unknown_count: number;
  cancelled_count: number;
}

export interface BulkPreviewPage {
  batch: BulkBatch;
  items: BulkRecipient[];
  page: number;
  size: number;
  total: number;
}

export interface BulkConfirmRequest {
  preview_hash: string;
  idempotency_key: string;
}

export interface BulkCancelResult {
  cancelled: number;
  in_flight: number;
  already_terminal: number;
}

export interface OutboundMessagePage {
  items: OutboundMessage[];
  page: number;
  size: number;
  total: number;
}

export interface OutboundMessageListFilters {
  leadId?: string;
  customerId?: string;
  status?: OutboundMessageStatus;
}

export interface ApiDataResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface ApiMessageDataResponse<T> extends ApiDataResponse<T> {
  message: string;
}
