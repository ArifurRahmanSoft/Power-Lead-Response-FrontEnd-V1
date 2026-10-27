import { HttpErrorResponse } from '@angular/common/http';

import {
  OutboundMessageContractError,
  outboundHistoryErrorMessage,
} from './outbound-message-errors';

describe('outboundHistoryErrorMessage', () => {
  it.each([
    [0, 'network request did not complete'],
    [401, 'session is no longer authorized'],
    [403, 'do not have permission'],
    [404, 'endpoint or authorized customer context was not found'],
    [422, 'rejected the customer email-history parameters'],
    [500, 'returned a server error'],
  ])('distinguishes HTTP status %s', (status, expected) => {
    const error = new HttpErrorResponse({ status, statusText: 'Failure' });
    expect(outboundHistoryErrorMessage(error)).toContain(expected);
  });

  it('identifies a response-contract mismatch separately', () => {
    expect(outboundHistoryErrorMessage(new OutboundMessageContractError())).toContain(
      'did not match the backend contract',
    );
  });
});
