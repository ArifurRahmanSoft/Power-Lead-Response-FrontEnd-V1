import { DataResponse } from '../../leads/models/lead.models';

export type CustomerDuplicateResolution = 'create_new' | 'link_existing';
export type AcquisitionTaskDisposition = 'cancel' | 'retain';

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company: string | null;
  communication_purpose: string;
  communication_consent_status: string;
  channel_restrictions: string[];
  suppressed_at: string | null;
  suppression_reason: string | null;
  created_at: string;
  row_version: number;
}

export interface LeadConversion {
  id: string;
  lead_id: string;
  customer_id: string;
  converted_at: string;
  converted_by: string;
  purchased_service: string;
  reference: string | null;
  reason: string;
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

export interface LeadConversionRequest {
  row_version: number;
  purchased_service: string;
  reference: string | null;
  reason: string;
  duplicate_resolution: CustomerDuplicateResolution;
  existing_customer_id?: string;
  pending_acquisition_task_disposition: AcquisitionTaskDisposition;
  pending_task_reason: string;
}

export interface LeadConversionResult {
  customer: Customer;
  conversion: LeadConversion;
  idempotent_replay: boolean;
}

export interface LeadConversionResponse extends DataResponse<LeadConversionResult> {
  message: string;
}
