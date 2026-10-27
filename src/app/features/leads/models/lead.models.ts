export const EMAIL_STATUSES = [
  'unknown',
  'unverified',
  'valid',
  'invalid',
  'bounced',
  'risky',
  'disposable',
] as const;

export const LEAD_STATUSES = [
  'new',
  'qualified',
  'contacted',
  'engaged',
  'converted',
  'disqualified',
] as const;

export const LEAD_SOURCES = ['manual', 'import'] as const;
export const LEAD_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const COMPANY_SIZES = [
  'self_employed',
  '1_10',
  '11_50',
  '51_200',
  '201_500',
  '501_1000',
  '1001_5000',
  '5001_10000',
  '10000_plus',
] as const;
export const REVENUE_PERIODS = ['monthly', 'quarterly', 'annual'] as const;
export const CONSENT_STATUSES = [
  'unknown',
  'not_requested',
  'granted',
  'denied',
  'withdrawn',
] as const;

export type EmailStatus = (typeof EMAIL_STATUSES)[number];
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadSource = (typeof LEAD_SOURCES)[number];
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];
export type CompanySize = (typeof COMPANY_SIZES)[number];
export type RevenuePeriod = (typeof REVENUE_PERIODS)[number];
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export interface LeadFieldsDto {
  first_name: string;
  last_name: string;
  email: string;
  designation?: string | null;
  company?: string | null;
  country?: string | null;
  email_status: EmailStatus;
  linkedin_url?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  x_url?: string | null;
  github_url?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  company_website?: string | null;
  industry?: string | null;
  service_requested?: string | null;
  company_size?: CompanySize | null;
  revenue_amount?: string | null;
  revenue_currency?: string | null;
  revenue_period?: RevenuePeriod | null;
  notes?: string | null;
  consent_status: ConsentStatus;
  consent_evidence?: string | null;
  consent_reference?: string | null;
}

export interface Lead extends LeadFieldsDto {
  id: string;
  tracking_id: string;
  source: LeadSource;
  status: LeadStatus;
  priority: LeadPriority;
  assigned_user_id: string | null;
  import_batch_id: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  row_version: number;
  email_summary?: LeadEmailSummary;
  sms_summary?: LeadSmsSummary;
}

export type LeadEmailState =
  'not_contacted_by_email' | 'queued' | 'processing' | 'sent' | 'failed' | 'unknown' | 'cancelled';

export type LeadEmailStage = 'initial' | 'follow_up' | 'second_follow_up' | 'final_follow_up';

export interface LeadEmailSummary {
  state: LeadEmailState;
  stage: LeadEmailStage | null;
  attempted_at?: string | null;
  sent_at?: string | null;
  last_successful_email_at?: string | null;
  attempt_count: number;
}

export interface LeadSmsSummary {
  contact_type: LeadEmailStage | null;
  provider_status: string;
  last_successful_at: string | null;
}

export interface LeadCreateRequest extends LeadFieldsDto {
  assigned_user_id?: string | null;
  status?: LeadStatus;
  priority?: LeadPriority;
}

export type LeadUpdateFields = Partial<LeadFieldsDto> & {
  assigned_user_id?: string | null;
  status?: LeadStatus;
  priority?: LeadPriority;
  assignment_reason?: string;
  pending_task_disposition?: PendingTaskDisposition;
};

export interface LeadUpdateRequest extends LeadUpdateFields {
  row_version: number;
}

export interface LeadFilters {
  search?: string;
  name?: string;
  email?: string;
  company?: string;
  country?: string;
  industry?: string;
  service_requested?: string;
  status?: LeadStatus | '';
  email_status?: EmailStatus | '';
  source?: LeadSource | '';
  assigned_user_id?: string;
  priority?: LeadPriority | '';
  email_state?: LeadEmailState | '';
  email_stage?: LeadEmailStage | '';
}

export interface LeadServiceOption {
  label: string;
  value: string;
}

export interface PageData<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface DataResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface ActionResponse {
  success: boolean;
  message: string;
}

export const PENDING_TASK_DISPOSITIONS = ['transfer', 'retain', 'cancel'] as const;
export type PendingTaskDisposition = (typeof PENDING_TASK_DISPOSITIONS)[number];

export interface LeadAssignmentHistory {
  id: string;
  lead_id: string;
  previous_assignee_id: string | null;
  new_assignee_id: string;
  actor_user_id: string;
  assigned_at: string;
  reason: string;
  task_disposition: PendingTaskDisposition;
  affected_task_count: number;
  lead_row_version: number;
}

export const LEAD_ACTIVITY_TYPES = [
  'initial_contact',
  'follow_up',
  'inbound_reply',
  'note',
] as const;
export const LEAD_ACTIVITY_CHANNELS = ['email', 'phone', 'sms', 'whatsapp', 'other'] as const;
export const LEAD_ACTIVITY_DIRECTIONS = ['outbound', 'inbound', 'internal'] as const;

export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];
export type LeadActivityChannel = (typeof LEAD_ACTIVITY_CHANNELS)[number];
export type LeadActivityDirection = (typeof LEAD_ACTIVITY_DIRECTIONS)[number];

export interface LeadActivityValues {
  activity_type: LeadActivityType;
  channel: LeadActivityChannel;
  direction: LeadActivityDirection;
  occurred_at: string;
  performed_by: string | null;
  outcome: string | null;
  notes: string | null;
}

export interface LeadActivity extends LeadActivityValues {
  id: string;
  lead_id: string;
  related_activity_id: string | null;
  recorded_by: string;
  recorded_at: string;
  is_system: boolean;
  is_amendment: boolean;
  externally_performed: boolean;
  provider_verified: boolean;
  amendment_reason: string | null;
  outbound_message_id?: string | null;
  message_status?: string | null;
  message_events?: Array<{
    status: string;
    safe_reason: string | null;
    occurred_at: string;
  }>;
  email_delivery_verified: boolean;
}

export interface ManualReplyCreateRequest {
  channel: LeadActivityChannel;
  occurred_at: string;
  summary: string;
  related_outbound_activity_id: string;
}

export interface ManualReply {
  id: string;
  lead_id: string;
  channel: LeadActivityChannel;
  occurred_at: string;
  summary: string;
  related_outbound_activity_id: string;
  recorded_by: string;
  recorded_at: string;
  provider_verified: boolean;
}

export const BOOKING_STATUSES = ['scheduled', 'confirmed', 'cancelled', 'completed'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type BookingSource = 'manual' | LeadActivityChannel;

export interface LeadBooking {
  id: string;
  lead_id: string;
  scheduled_at: string;
  timezone: string;
  responsible_user_id: string;
  source: BookingSource;
  status: BookingStatus;
  notes: string | null;
  provider_verified: boolean;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  row_version: number;
}

export interface LeadBookingCreateRequest {
  scheduled_at: string;
  timezone: string;
  responsible_user_id: string;
  source: BookingSource;
  status: Extract<BookingStatus, 'scheduled' | 'confirmed'>;
  notes: string | null;
}

export interface LeadBookingTransitionRequest {
  row_version: number;
  notes: string | null;
}

export interface LeadBookingRescheduleRequest extends LeadBookingTransitionRequest {
  scheduled_at: string;
  timezone: string;
}

export type LeadBookingEventType = 'created' | 'confirmed' | 'cancelled' | 'rescheduled';

export interface LeadBookingEvent {
  id: string;
  event_type: LeadBookingEventType;
  previous_status: BookingStatus | null;
  new_status: BookingStatus;
  previous_scheduled_at: string | null;
  new_scheduled_at: string;
  previous_timezone: string | null;
  new_timezone: string;
  notes: string | null;
  recorded_by: string;
  recorded_at: string;
}

export interface LeadActivityCreateRequest extends LeadActivityValues {
  related_activity_id?: string | null;
}

export interface LeadActivityAmendRequest extends Partial<LeadActivityValues> {
  amendment_reason: string;
}

export interface LeadImportSummary {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  inserted: number;
  failed: number;
}

export type LeadImportStatus = 'previewed' | 'committing' | 'completed' | 'completed_with_errors';

export interface LeadImportBatch {
  id: string;
  status: LeadImportStatus;
  file_name: string;
  mapping: Record<string, string>;
  summary: LeadImportSummary;
  expires_at: string;
  created_at: string;
  committed_at: string | null;
}

export interface LeadImportRowError {
  field: string;
  message: string;
}

export interface LeadImportRow {
  row_number: number;
  status: string;
  errors: LeadImportRowError[];
  lead_id: string | null;
}

export const LEAD_STATUS_TRANSITIONS: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  new: ['qualified', 'contacted', 'disqualified'],
  qualified: ['contacted', 'disqualified'],
  contacted: ['engaged', 'disqualified'],
  engaged: ['converted', 'disqualified'],
  converted: [],
  disqualified: ['new'],
};

export const IMPORT_CANONICAL_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'designation',
  'company',
  'country',
  'email_status',
  'linkedin_url',
  'facebook_url',
  'instagram_url',
  'x_url',
  'github_url',
  'phone',
  'city',
  'state',
  'company_website',
  'industry',
  'service_requested',
  'company_size',
  'revenue_amount',
  'revenue_currency',
  'revenue_period',
  'notes',
  'consent_status',
  'consent_evidence',
  'consent_reference',
] as const;
