import {
  CompanySize,
  ConsentStatus,
  DataResponse,
  RevenuePeriod,
} from '../../leads/models/lead.models';

export type CustomerDuplicateResolution = 'create_new' | 'link_existing';
export type AcquisitionTaskDisposition = 'cancel' | 'retain';

export interface CustomerFieldsDto {
  first_name: string;
  last_name: string;
  email: string;
  designation?: string | null;
  company?: string | null;
  country?: string | null;
  linkedin_url?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  x_url?: string | null;
  github_url?: string | null;
  phone?: string | null;
  whatsapp_number?: string | null;
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
  assigned_user_id?: string | null;
  communication_consent_status: ConsentStatus;
  consent_reference?: string | null;
}

export interface Customer extends CustomerFieldsDto {
  id: string;
  communication_purpose: string;
  consent_evidence?: string | null;
  channel_restrictions: string[];
  suppressed_at: string | null;
  suppression_reason: string | null;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  row_version: number;
  /** Present when the backend confirms the customer record's origin. */
  source_type?: 'direct' | 'lead' | null;
  source_lead_id?: string | null;
  source_lead_label?: string | null;
  converted_at?: string | null;
}

export interface LeadConversion {
  id: string;
  lead_id: string;
  customer_id: string;
  converted_at: string;
  converted_by: string;
  purchased_service: string | null;
  reference: string | null;
  reason: string | null;
  duplicate_resolution: CustomerDuplicateResolution;
  pending_task_disposition: AcquisitionTaskDisposition;
  pending_task_reason: string;
  cancelled_nurture_job_count: number;
  affected_task_count: number;
  source_consent_status: string;
  source_consent_evidence: string | null;
  source_consent_reference: string | null;
}

export interface CustomerDetail extends Customer {
  conversions: LeadConversion[];
}

export interface CustomerPage {
  items: Customer[];
  page: number;
  size: number;
  total: number;
}

export type CustomerCreateRequest = CustomerFieldsDto;

export interface CustomerUpdateRequest extends Partial<CustomerFieldsDto> {
  row_version: number;
}

export interface CustomerResponse extends DataResponse<Customer> {
  message: string;
}

export interface LeadConversionRequest {
  row_version: number;
  purchased_service?: string | null;
  reference?: string | null;
  reason?: string | null;
  duplicate_resolution?: CustomerDuplicateResolution;
  existing_customer_id?: string;
  pending_acquisition_task_disposition?: AcquisitionTaskDisposition;
  pending_task_reason?: string | null;
}

export interface LeadConversionResult {
  customer: Customer;
  conversion: LeadConversion;
  idempotent_replay: boolean;
}

export interface LeadConversionResponse extends DataResponse<LeadConversionResult> {
  message: string;
}
