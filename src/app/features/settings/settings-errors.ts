import { HttpErrorResponse } from '@angular/common/http';

interface ApiErrorBody {
  detail?: string;
  message?: string;
  errors?: Array<{ field?: string; message?: string }>;
}

export function settingsErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;
  const body = error.error as ApiErrorBody | string | null;
  if (typeof body === 'string' && body) return body;
  if (body && typeof body === 'object') {
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.errors)) {
      const messages = body.errors.flatMap((item) => (item.message ? [item.message] : []));
      if (messages.length) return messages.join(' ');
    }
    if (typeof body.message === 'string') return body.message;
  }
  if (error.status === 0) return 'Unable to reach the server. Please try again.';
  return fallback;
}
