import { HttpErrorResponse } from '@angular/common/http';

interface SafeApiError {
  detail?: unknown;
  message?: unknown;
  errors?: unknown;
}

export function senderAccountErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;
  const body = error.error as SafeApiError | string | null;
  if (typeof body === 'string') return fallback;
  if (body && typeof body === 'object') {
    if (typeof body.detail === 'string' && body.detail.trim()) return body.detail;
    if (Array.isArray(body.errors)) {
      const messages = body.errors
        .map((issue) =>
          issue && typeof issue === 'object' && 'message' in issue
            ? (issue as { message?: unknown }).message
            : null,
        )
        .filter((message): message is string => typeof message === 'string' && !!message.trim());
      if (messages.length) return messages.join(' ');
    }
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
  }
  if (error.status === 0) return 'Unable to reach the server. Please try again.';
  return fallback;
}
