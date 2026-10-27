import { HttpErrorResponse } from '@angular/common/http';

import { smsSendFailure } from './sms-send-errors';

describe('smsSendFailure', () => {
  it.each([
    [403, { detail: 'Insufficient workspace permission' }, 'mail.send access'],
    [404, { detail: 'Message template not found' }, 'Message Template no longer exists'],
    [429, { detail: 'Rate limit exceeded' }, 'Wait before trying again'],
    [503, { detail: 'Twilio SMS is not configured' }, 'Twilio SMS is not configured'],
  ])('surfaces definitive HTTP %i failures', (status, body, expected) => {
    const failure = smsSendFailure(
      new HttpErrorResponse({ error: body, status, statusText: 'Failure' }),
    );

    expect(failure.uncertain).toBe(false);
    expect(failure.status).toBe(status);
    expect(failure.message).toContain(`HTTP ${status}`);
    expect(failure.message).toContain(expected);
  });

  it('surfaces backend validation fields instead of a generic error', () => {
    const failure = smsSendFailure(
      new HttpErrorResponse({
        status: 422,
        statusText: 'Unprocessable Entity',
        error: {
          detail: [
            { loc: ['body', 'lead_ids'], msg: 'List should have at most 10 items' },
            { loc: ['body', 'contact_type'], msg: 'Input should be a valid contact type' },
          ],
        },
      }),
    );

    expect(failure.uncertain).toBe(false);
    expect(failure.message).toContain('lead ids: List should have at most 10 items');
    expect(failure.message).toContain('contact type: Input should be a valid contact type');
  });

  it.each([0, 500, 502, 504])('reserves uncertainty for ambiguous HTTP %i outcomes', (status) => {
    const failure = smsSendFailure(
      new HttpErrorResponse({ status, statusText: status ? 'Gateway failure' : 'Network error' }),
    );

    expect(failure.uncertain).toBe(true);
    expect(failure.status).toBe(status);
  });
});
