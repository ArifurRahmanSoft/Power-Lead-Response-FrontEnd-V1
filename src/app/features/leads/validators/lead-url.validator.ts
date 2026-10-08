import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

const SCHEME_PREFIX = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Applies the same user-facing URL rules as the lead API. Bare public domains
 * are treated as HTTPS, while explicitly supplied HTTP/HTTPS schemes are kept.
 */
export function normalizeLeadUrl(value: string | null | undefined): string | null {
  const raw = value?.trim() || '';
  if (!raw) return null;
  if (/\s/.test(raw)) return null;

  const scheme = SCHEME_PREFIX.exec(raw)?.[1]?.toLowerCase();
  let candidate: string;
  if (!scheme) {
    candidate = `https://${raw}`;
  } else if (scheme === 'http' || scheme === 'https') {
    if (!raw.toLowerCase().startsWith(`${scheme}://`)) return null;
    candidate = raw;
  } else if (scheme.includes('.')) {
    // URL parsers interpret a bare domain followed by a port as a scheme.
    candidate = `https://${raw}`;
  } else {
    return null;
  }

  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password || !url.hostname || url.hostname.endsWith('.')) return null;

    const hostname = url.hostname.toLowerCase();
    const isIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
    const isIpv6 = hostname.startsWith('[') && hostname.endsWith(']');
    if (isIpv4) {
      if (hostname.split('.').some((part) => Number(part) > 255)) return null;
    } else if (!isIpv6) {
      const labels = hostname.split('.');
      if (labels.length < 2 || labels.some((label) => !HOST_LABEL.test(label))) return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export const optionalLeadUrlValidator: ValidatorFn = (
  control: AbstractControl<string>,
): ValidationErrors | null => {
  const value = control.value?.trim() || '';
  return !value || normalizeLeadUrl(value) ? null : { url: true };
};
