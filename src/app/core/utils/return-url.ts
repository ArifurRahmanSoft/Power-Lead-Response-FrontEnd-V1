const PUBLIC_AUTH_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password'];

export function safeInternalReturnUrl(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || /[\u0000-\u001f]/.test(value)) return null;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.includes('\\')) return null;
  const pathname = decoded.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  return PUBLIC_AUTH_ROUTES.includes(pathname) ? null : value;
}
