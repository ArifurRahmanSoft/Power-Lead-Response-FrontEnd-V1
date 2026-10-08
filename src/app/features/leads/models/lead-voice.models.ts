import { CompanySize, RevenuePeriod } from './lead.models';

export const LEAD_VOICE_MAX_DURATION_SECONDS = 120;

export interface LeadVoiceDraft {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  designation: string | null;
  company: string | null;
  city: string | null;
  state: string | null;
  company_website: string | null;
  industry: string | null;
  company_size: CompanySize | null;
  revenue_amount: string | number | null;
  revenue_currency: string | null;
  revenue_period: RevenuePeriod | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  x_url: string | null;
  github_url: string | null;
  service_requested: string | null;
  notes: string | null;
}

export type LeadVoiceFieldName = keyof LeadVoiceDraft;
export type LeadVoiceFormValues = Partial<Record<LeadVoiceFieldName, string>>;

export interface LeadVoiceFieldError {
  field: string;
  message: string;
}

export interface LeadVoiceExtractResponse {
  transcript: string;
  extracted_fields: LeadVoiceDraft;
  field_errors: LeadVoiceFieldError[];
  review_warnings: string[];
}

export interface LeadVoiceRecording {
  blob: Blob;
  filename: string;
  mimeType: string;
}

export type LeadVoiceRecordingErrorCode =
  | 'unsupported'
  | 'insecure'
  | 'permission-denied'
  | 'device-not-found'
  | 'device-unavailable'
  | 'recording-failed';

export class LeadVoiceRecordingError extends Error {
  constructor(
    readonly code: LeadVoiceRecordingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LeadVoiceRecordingError';
  }
}
