import { HttpErrorResponse } from '@angular/common/http';

export class OutboundMessageContractError extends Error {
  constructor() {
    super('The email history response did not match the backend contract.');
    this.name = 'OutboundMessageContractError';
  }
}

export function outboundHistoryErrorMessage(error: unknown): string {
  if (error instanceof OutboundMessageContractError) return error.message;
  if (!(error instanceof HttpErrorResponse)) {
    return 'Unable to load customer email activity because the response could not be processed.';
  }
  if (error.status === 0) {
    return 'The email history network request did not complete. Check that the configured API is running and allows this frontend origin.';
  }
  if (error.status === 401) {
    return 'Your session is no longer authorized. Sign in again to view email history.';
  }
  if (error.status === 403) {
    return 'You do not have permission to view email history for this customer.';
  }
  if (error.status === 404) {
    return 'The email history endpoint or authorized customer context was not found.';
  }
  if (error.status === 422) {
    return 'The backend rejected the customer email-history parameters.';
  }
  if (error.status >= 500) {
    return 'The email history service returned a server error. The customer details remain available.';
  }
  return 'Unable to load customer email activity.';
}
