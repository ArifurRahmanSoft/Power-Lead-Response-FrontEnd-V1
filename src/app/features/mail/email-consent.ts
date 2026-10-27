const EXPLICIT_EMAIL_CONSENT_DENIALS = new Set(['denied', 'withdrawn']);

export function normalizeEmailConsentStatus(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_')
    .split('_')
    .filter(Boolean)
    .join('_');
}

export function isEmailConsentDenied(value: unknown): boolean {
  return EXPLICIT_EMAIL_CONSENT_DENIALS.has(normalizeEmailConsentStatus(value));
}

export function emailConsentDenialIssue(
  subject: 'Lead' | 'Customer',
  value: unknown,
): string | null {
  const normalized = normalizeEmailConsentStatus(value);
  if (!EXPLICIT_EMAIL_CONSENT_DENIALS.has(normalized)) return null;
  return normalized === 'withdrawn'
    ? `${subject} email consent was withdrawn.`
    : `${subject} email consent is explicitly denied.`;
}
