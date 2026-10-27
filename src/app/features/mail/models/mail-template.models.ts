export type MailTemplateApprovalStatus = 'draft' | 'approved';
export type MailTemplateAssetKind = 'inline_body' | 'signature_image' | 'attachment';

export interface MailTemplateListItem {
  id: string;
  name: string;
  enabled: boolean;
  archived: boolean;
  version: number;
  approval_status: MailTemplateApprovalStatus;
  subject: string;
  updated_at: string;
}

export interface MailTemplateAsset {
  id: string;
  kind: MailTemplateAssetKind;
  filename: string;
  content_type: string;
  size_bytes: number;
  placeholder_html: string | null;
  content_url: string;
  created_at: string;
}

export interface MailTemplate extends MailTemplateListItem {
  version_id: string;
  body_html: string;
  body_text: string;
  signature_html: string;
  signature_text: string;
  assets: MailTemplateAsset[];
  approved_at: string | null;
  created_at: string;
  version_created_at: string;
  version_updated_at: string;
}

export interface MailTemplateListData {
  items: MailTemplateListItem[];
  page: number;
  size: number;
  total: number;
}

export interface MailTemplateCreateRequest {
  name: string;
  subject: string;
  body_html: string;
  signature_html: string;
  enabled: boolean;
}

export type MailTemplateUpdateRequest = Partial<MailTemplateCreateRequest>;

export interface PlaceholderDefinition {
  key: string;
  label: string;
}

export interface TemplateRenderIssue {
  placeholder: string;
  message: string;
}

export interface MailTemplatePreviewRequest {
  lead_id?: string;
  sample_values?: Record<string, string | null>;
  version?: number;
}

export interface MailTemplatePreview {
  template_id: string;
  version: number;
  rendered_subject: string;
  rendered_body_html: string;
  rendered_signature_html: string;
  rendered_html: string;
  rendered_text: string;
  missing_values: TemplateRenderIssue[];
  warnings: string[];
  asset_urls: Record<string, string>;
}

export interface MailTemplateListFilters {
  search?: string;
  enabled?: boolean;
  approvalStatus?: MailTemplateApprovalStatus;
  includeArchived?: boolean;
}

export interface ApiDataResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface ApiActionResponse {
  success: boolean;
  message: string;
}

export const MAIL_TEMPLATE_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxAssets: 20,
  maxEncodedTotalBytes: 25 * 1024 * 1024,
  maxNameLength: 120,
  maxSubjectLength: 255,
  maxBodyLength: 200_000,
  maxSignatureLength: 100_000,
} as const;

export const INLINE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
export const ATTACHMENT_ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,application/pdf,.docx,.xlsx,.txt,.csv';
