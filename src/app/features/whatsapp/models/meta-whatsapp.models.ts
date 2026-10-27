import {
  ApiDataResponse,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppOperationState,
  WhatsAppRestriction,
} from './whatsapp.models';

export type MetaWhatsAppPurpose = 'lead_acquisition' | 'customer_service';
export type MetaWhatsAppSendMode = 'text' | 'approved_template';
export type MetaTemplateComponentType = 'header' | 'body' | 'button';

export interface MetaWhatsAppChannel {
  id: string;
  provider: 'meta';
  waba_id: string;
  phone_number_id: string;
  sender_address: string;
  active: boolean;
}

export interface MetaWhatsAppEligibility {
  free_form_allowed: boolean;
  service_window_expires_at: string | null;
  approved_template_required: boolean;
  template_outreach_allowed: boolean;
  restrictions: WhatsAppRestriction[];
}

export interface MetaWhatsAppConversation {
  id: string;
  external_address: string;
  lead_id: string | null;
  customer_id: string | null;
  contact_name: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  unread_count: number;
  eligibility: MetaWhatsAppEligibility;
}

export interface MetaWhatsAppConversationPage {
  items: MetaWhatsAppConversation[];
  page: number;
  size: number;
  total: number;
  pages: number;
}

export interface MetaWhatsAppMediaMetadata {
  type: string;
  provider_media_id: string | null;
  unsupported: boolean;
}

export interface MetaWhatsAppMessage {
  id: string;
  conversation_id: string;
  direction: WhatsAppMessageDirection;
  provider: 'meta';
  mode: string;
  purpose: string | null;
  body: string;
  media: MetaWhatsAppMediaMetadata[];
  status: WhatsAppMessageStatus;
  provider_message_id: string | null;
  provider_error_code: string | null;
  failure_reason: string | null;
  requested_by_user_id: string | null;
  occurred_at: string;
  completed_at: string | null;
}

export interface MetaWhatsAppMessagePage {
  conversation: MetaWhatsAppConversation;
  items: MetaWhatsAppMessage[];
  page: number;
  size: number;
  total: number;
  pages: number;
}

export interface MetaTemplateVariable {
  component: MetaTemplateComponentType;
  index: number;
}

export interface MetaApprovedTemplate {
  id: string | null;
  name: string;
  language: string;
  category: string | null;
  provider_status: string;
  usable: boolean;
  components: Array<Record<string, unknown>>;
  required_variables: MetaTemplateVariable[];
}

export interface MetaApprovedTemplatePage {
  items: MetaApprovedTemplate[];
  page: number;
  size: number;
  total: number;
  pages: number;
}

export interface MetaTemplateParameter extends MetaTemplateVariable {
  value: string;
}

export interface MetaApprovedTemplateRequest {
  name: string;
  language: string;
  parameters: readonly Readonly<MetaTemplateParameter>[];
}

export interface MetaTextSendRequest {
  conversation_id: string;
  mode: 'text';
  text: string;
  purpose: MetaWhatsAppPurpose;
  idempotency_key: string;
}

export interface MetaTemplateSendRequest {
  conversation_id: string;
  mode: 'approved_template';
  template: MetaApprovedTemplateRequest;
  purpose: MetaWhatsAppPurpose;
  idempotency_key: string;
}

export type MetaWhatsAppSendRequest = MetaTextSendRequest | MetaTemplateSendRequest;

export interface MetaWhatsAppSendResult {
  message: MetaWhatsAppMessage;
  replayed: boolean;
  operation_state: WhatsAppOperationState;
}

export interface MetaWhatsAppRecoveryResult {
  idempotency_key: string;
  found: boolean;
  operation_state: WhatsAppOperationState;
  message: MetaWhatsAppMessage | null;
}

export interface MetaWhatsAppReadResult {
  conversation_id: string;
  unread_count: number;
  last_read_at: string;
}

export interface MetaWhatsAppOpenRequest {
  phone_number: string;
}

export interface MetaWhatsAppLinkRequest {
  lead_id?: string;
  customer_id?: string;
}

export type MetaChannelResponse = ApiDataResponse<MetaWhatsAppChannel>;
