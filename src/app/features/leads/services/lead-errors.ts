import { HttpErrorResponse } from '@angular/common/http';

interface ApiError {
  detail?:
    | string
    | { message?: string; existing_lead?: { id: string; tracking_id: string } }
    | ApiValidationError[];
  message?: string;
  errors?: ApiValidationError[] | Record<string, string | string[]>;
}

interface ApiValidationError {
  loc?: Array<string | number>;
  field?: string;
  msg?: string;
  message?: string;
}

export interface LeadErrorDetails {
  message: string;
  fieldErrors: Record<string, string>;
  duplicate?: { id: string; tracking_id: string };
  forbidden: boolean;
  stale: boolean;
}

export function leadErrorDetails(error: unknown, fallback: string): LeadErrorDetails {
  const result: LeadErrorDetails = {
    message: fallback,
    fieldErrors: {},
    forbidden: false,
    stale: false,
  };
  if (!(error instanceof HttpErrorResponse)) return result;
  result.forbidden = error.status === 403;
  const body = error.error as ApiError | string | null;
  if (typeof body === 'string' && body) result.message = body;
  if (body && typeof body === 'object') {
    const detail = body.detail;
    if (typeof detail === 'string') result.message = detail;
    if (detail && !Array.isArray(detail) && typeof detail === 'object') {
      result.message = detail.message || fallback;
      result.duplicate = detail.existing_lead;
    }
    const validation = Array.isArray(detail)
      ? detail
      : Array.isArray(body.errors)
        ? body.errors
        : [];
    for (const item of validation) {
      const field =
        item.field ||
        item.loc
          ?.filter((part) => part !== 'body')
          .at(-1)
          ?.toString();
      const message = item.message || item.msg;
      if (field && message) result.fieldErrors[field] = message.replace(/^Value error, /, '');
    }
    if (typeof body.message === 'string') result.message = body.message;
    if (body.errors && !Array.isArray(body.errors)) {
      for (const [field, messages] of Object.entries(body.errors)) {
        result.fieldErrors[field] = Array.isArray(messages) ? messages.join(' ') : messages;
      }
    }
  }
  if (error.status === 0) result.message = 'Unable to reach the server. Please try again.';
  result.stale = error.status === 409 && /modified|version|stale/i.test(result.message);
  return result;
}
