import {
  emailConsentDenialIssue,
  isEmailConsentDenied,
  normalizeEmailConsentStatus,
} from './email-consent';

describe('email consent eligibility', () => {
  it.each([null, undefined, '', '   ', 'unknown', 'not_requested', 'granted', 'legacy_status'])(
    'does not treat %s as granted or as an explicit denial',
    (status) => {
      expect(isEmailConsentDenied(status)).toBe(false);
      expect(emailConsentDenialIssue('Lead', status)).toBeNull();
    },
  );

  it('normalizes values and blocks explicit refusal or withdrawal only', () => {
    expect(normalizeEmailConsentStatus('  Not  Requested ')).toBe('not_requested');
    expect(emailConsentDenialIssue('Lead', ' DENIED ')).toBe(
      'Lead email consent is explicitly denied.',
    );
    expect(emailConsentDenialIssue('Customer', 'WithDrawn')).toBe(
      'Customer email consent was withdrawn.',
    );
  });
});
