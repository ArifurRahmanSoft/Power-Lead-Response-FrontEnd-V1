import { HttpErrorResponse } from '@angular/common/http';

import { leadErrorDetails } from '../leads/services/lead-errors';

export interface InstagramSendFailure {
  uncertain: boolean;
  message: string;
}

const DEFINITIVE_STATUSES = new Set([400, 401, 403, 404, 409, 413, 422, 429]);

export function instagramSendFailure(error: unknown): InstagramSendFailure {
  if (!(error instanceof HttpErrorResponse) || error.status === 0) {
    return {
      uncertain: true,
      message: 'No reliable HTTP result was received. The Instagram reply outcome is unknown.',
    };
  }
  const details = leadErrorDetails(error, 'The backend rejected the Instagram reply.');
  const validation = Object.entries(details.fieldErrors)
    .map(([field, message]) => `${field.replaceAll('_', ' ')}: ${message}`)
    .join(' ');
  let message = validation || details.message;
  const providerCode = typeof error.error?.detail?.code === 'string' ? error.error.detail.code : '';
  if (providerCode === 'meta_instagram_channel_not_configured') {
    message +=
      ' Ask a workspace administrator to configure the Meta Instagram channel for this workspace.';
  }
  if (DEFINITIVE_STATUSES.has(error.status)) return { uncertain: false, message };
  if (
    error.status === 503 &&
    (providerCode === 'meta_instagram_channel_not_configured' ||
      (providerCode && providerCode !== 'acceptance_unknown') ||
      /not configured|configuration|disabled|rejected/i.test(message))
  ) {
    return { uncertain: false, message };
  }
  if (error.status >= 500) {
    return {
      uncertain: true,
      message: 'The backend could not prove whether Meta accepted the original reply.',
    };
  }
  return { uncertain: false, message };
}
