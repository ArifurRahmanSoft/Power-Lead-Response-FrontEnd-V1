import { FormControl } from '@angular/forms';

import { normalizeLeadUrl, optionalLeadUrlValidator } from './lead-url.validator';

describe('lead URL validation', () => {
  it.each([
    ['google.com', 'https://google.com/'],
    ['www.google.com', 'https://www.google.com/'],
    ['https://google.com', 'https://google.com/'],
    ['http://google.com', 'http://google.com/'],
    ['google.com/path?q=1', 'https://google.com/path?q=1'],
  ])('accepts and safely normalizes %s', (input, expected) => {
    expect(normalizeLeadUrl(input)).toBe(expected);
    expect(optionalLeadUrlValidator(new FormControl(input, { nonNullable: true }))).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    'ftp://google.com',
    'https://user:password@google.com',
    'https://google .com',
    'not-a-public-hostname',
  ])('rejects malformed or unsafe input %s', (input) => {
    expect(normalizeLeadUrl(input)).toBeNull();
    expect(optionalLeadUrlValidator(new FormControl(input, { nonNullable: true }))).toEqual({
      url: true,
    });
  });

  it('keeps the optional field valid when blank', () => {
    expect(optionalLeadUrlValidator(new FormControl('', { nonNullable: true }))).toBeNull();
  });
});
