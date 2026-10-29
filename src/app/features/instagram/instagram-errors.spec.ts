import { HttpErrorResponse } from '@angular/common/http';

import { instagramSendFailure } from './instagram-errors';

describe('instagramSendFailure', () => {
  it('separates definitive provider rejection from uncertain transport failure', () => {
    const rejected = instagramSendFailure(
      new HttpErrorResponse({
        status: 503,
        error: { detail: { code: '190', message: 'The Instagram access token expired' } },
      }),
    );
    expect(rejected.uncertain).toBe(false);
    expect(rejected.message).toContain('expired');

    const uncertain = instagramSendFailure(new HttpErrorResponse({ status: 0 }));
    expect(uncertain.uncertain).toBe(true);
    expect(uncertain.message).toContain('unknown');
  });
});
