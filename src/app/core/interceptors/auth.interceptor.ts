import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { API_CONFIG } from '../config/api.config';
import { AuthService } from '../services/auth.service';
import { safeInternalReturnUrl } from '../utils/return-url';

const PUBLIC_AUTH_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

const LOCALLY_HANDLED_FORBIDDEN_PATHS = new Set(['/auth/me', '/auth/select-workspace']);

function backendPath(requestUrl: string): string | null {
  try {
    const base = new URL(API_CONFIG.baseUrl);
    const request = new URL(requestUrl, base);
    const apiRoot = base.pathname.replace(/\/+$/, '');
    if (request.origin !== base.origin) return null;
    if (request.pathname !== apiRoot && !request.pathname.startsWith(`${apiRoot}/`)) return null;
    return request.pathname.slice(apiRoot.length) || '/';
  } catch {
    return null;
  }
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const path = backendPath(request.url);
  const isPublicRequest = path !== null && PUBLIC_AUTH_PATHS.has(path);
  const token = authService.getAccessToken();
  const outgoing =
    path !== null && !isPublicRequest && token
      ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : request;

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || path === null || isPublicRequest) {
        return throwError(() => error);
      }

      if (error.status === 401) {
        authService.clearInvalidSession();
        const returnUrl = safeInternalReturnUrl(router.url);
        void router.navigate(['/login'], {
          queryParams: returnUrl ? { returnUrl } : undefined,
        });
      } else if (
        error.status === 403 &&
        !LOCALLY_HANDLED_FORBIDDEN_PATHS.has(path) &&
        !(path.startsWith('/settings/') && request.method !== 'GET')
      ) {
        void router.navigate(['/access-denied']);
      }

      return throwError(() => error);
    }),
  );
};
