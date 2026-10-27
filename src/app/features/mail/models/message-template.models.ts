export interface MessageTemplate {
  id: string;
  tenant_id: string;
  category: 'message';
  name: string;
  body: string;
  archived: boolean;
  created_by_user_id: string;
  updated_by_user_id: string;
  archived_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface MessageTemplatePage {
  items: MessageTemplate[];
  page: number;
  size: number;
  total: number;
}

export interface MessageTemplateWriteRequest {
  name: string;
  body: string;
}

export interface MessageTemplatePlaceholder {
  key: string;
  label: string;
}

export interface MessageTemplateRenderIssue {
  placeholder: string;
  message: string;
}

export interface MessageTemplatePreview {
  template_id: string;
  rendered_body: string;
  missing_values: MessageTemplateRenderIssue[];
  warnings: string[];
}

export interface MessageTemplatePreviewRequest {
  lead_id?: string;
  sample_values?: Record<string, string | null>;
}

export interface MessageTemplateListFilters {
  search?: string;
  includeArchived?: boolean;
}

export interface MessageTemplateApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface MessageTemplateActionResponse {
  success: boolean;
  message: string;
}

export const MESSAGE_TEMPLATE_LIMITS = {
  name: 200,
  body: 10_000,
} as const;
