import { HttpErrorResponse } from '@angular/common/http';

import { leadErrorDetails } from '../leads/services/lead-errors';

export interface SmsSendFailure {
  status: number | null;
  uncertain: boolean;
  message: string;
}

const DEFINITIVE_HTTP_STATUSES = new Set([400, 401, 403, 404, 409, 413, 422, 429]);

export function smsSendFailure(error: unknown): SmsSendFailure {
  if (!(error instanceof HttpErrorResponse)) {
    return {
      status: null,
      uncertain: true,
      message:
        'The request ended without a readable HTTP response. The send outcome may be uncertain.',
    };
  }

  if (error.status === 0) {
    return {
      status: 0,
      uncertain: true,
      message: 'No HTTP response was received. The server may still have processed the request.',
    };
  }

  const details = leadErrorDetails(error, 'The backend rejected the SMS request.');
  const validation = Object.entries(details.fieldErrors)
    .map(([field, message]) => `${field.replaceAll('_', ' ')}: ${message}`)
    .join(' ');
  const backendMessage = validation || details.message;
  const statusPrefix = `HTTP ${error.status}`;

  if (DEFINITIVE_HTTP_STATUSES.has(error.status)) {
    return {
      status: error.status,
      uncertain: false,
      message: `${statusPrefix}: ${definitiveMessage(error.status, backendMessage)}`,
    };
  }

  if (isDefinitiveConfigurationFailure(error.status, backendMessage)) {
    return {
      status: error.status,
      uncertain: false,
      message: `${statusPrefix}: ${backendMessage}`,
    };
  }

  if (error.status >= 500) {
    return {
      status: error.status,
      uncertain: true,
      message: `${statusPrefix}: the backend or an upstream gateway failed without proving whether the original request completed.`,
    };
  }

  return {
    status: error.status,
    uncertain: false,
    message: `${statusPrefix}: ${backendMessage}`,
  };
}

function definitiveMessage(status: number, backendMessage: string): string {
  if (status === 401) return 'Your session is no longer authorized. Sign in and try again.';
  if (status === 403)
    return 'You do not have permission to send SMS in this workspace. Ask an administrator for mail.send access.';
  if (status === 404 && /template/i.test(backendMessage))
    return 'The selected Message Template no longer exists. Reopen the composer and choose an available template.';
  if (status === 409 && /idempotency/i.test(backendMessage))
    return 'The idempotency key conflicts with a different SMS request. No new request was created.';
  if (status === 413) return 'The SMS request is larger than the backend accepts.';
  if (status === 429) return 'Too many SMS requests were submitted. Wait before trying again.';
  return backendMessage;
}

function isDefinitiveConfigurationFailure(status: number, message: string): boolean {
  return (
    status === 503 &&
    /(not configured|configuration (?:is )?missing|disabled|missing configuration)/i.test(message)
  );
}
