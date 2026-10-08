import { safeInternalReturnUrl } from './return-url';

describe('safeInternalReturnUrl', () => {
  it('keeps safe application routes', () => {
    expect(safeInternalReturnUrl('/leads?view=mine')).toBe('/leads?view=mine');
  });

  it('rejects external, protocol-relative, encoded protocol-relative, and auth-loop URLs', () => {
    expect(safeInternalReturnUrl('https://example.com')).toBeNull();
    expect(safeInternalReturnUrl('//example.com')).toBeNull();
    expect(safeInternalReturnUrl('/%2Fexample.com')).toBeNull();
    expect(safeInternalReturnUrl('/login')).toBeNull();
  });
});
