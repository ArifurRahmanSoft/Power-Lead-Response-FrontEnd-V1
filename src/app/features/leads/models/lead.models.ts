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
  assigned_user_id: string | null;
  import_batch_id: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  row_version: number;
}

export interface LeadCreateRequest extends LeadFieldsDto {
  assigned_user_id?: string | null;
  status?: LeadStatus;
}

export type LeadUpdateFields = Partial<LeadFieldsDto> & {
  assigned_user_id?: string | null;
  status?: LeadStatus;
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
