import { HttpErrorResponse } from '@angular/common/http';

import { leadErrorDetails } from '../leads/services/lead-errors';

export interface MessengerSendFailure {
  uncertain: boolean;
  message: string;
}

const DEFINITIVE_STATUSES = new Set([400, 401, 403, 404, 409, 413, 422, 429]);

export function messengerSendFailure(error: unknown): MessengerSendFailure {
  if (!(error instanceof HttpErrorResponse)) {
    return {
      uncertain: true,
      message:
        'The request ended without a readable HTTP response. The reply outcome may be uncertain.',
    };
  }
  if (error.status === 0) {
    return {
      uncertain: true,
      message: 'No HTTP response was received. The server may still have processed the reply.',
    };
  }
  const details = leadErrorDetails(error, 'The backend rejected the Messenger reply.');
  const validation = Object.entries(details.fieldErrors)
    .map(([field, message]) => `${field.replaceAll('_', ' ')}: ${message}`)
    .join(' ');
  const message = validation || details.message;
  if (DEFINITIVE_STATUSES.has(error.status)) return { uncertain: false, message };
  if (error.status === 503 && /not configured|configuration|disabled/i.test(message)) {
    return { uncertain: false, message };
  }
  if (error.status >= 500) {
    return {
      uncertain: true,
      message:
        'The backend or provider failed without proving whether the original reply completed.',
    };
  }
  return { uncertain: false, message };
}
