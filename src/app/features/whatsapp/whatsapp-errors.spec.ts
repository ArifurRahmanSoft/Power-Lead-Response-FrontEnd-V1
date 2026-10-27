import { HttpErrorResponse } from '@angular/common/http';

import { whatsappSendFailure } from './whatsapp-errors';

describe('whatsappSendFailure', () => {
  it('treats a missing HTTP response as uncertain', () => {
    expect(whatsappSendFailure(new HttpErrorResponse({ status: 0 })).uncertain).toBe(true);
  });

  it('treats service-window and validation rejections as definitive', () => {
    const failure = whatsappSendFailure(
      new HttpErrorResponse({
        status: 409,
        error: { detail: { message: 'An approved WhatsApp template is required' } },
      }),
    );
    expect(failure.uncertain).toBe(false);
    expect(failure.message).toContain('approved WhatsApp template');
  });

  it('keeps an unexplained server failure uncertain', () => {
    expect(whatsappSendFailure(new HttpErrorResponse({ status: 502 })).uncertain).toBe(true);
  });
});
