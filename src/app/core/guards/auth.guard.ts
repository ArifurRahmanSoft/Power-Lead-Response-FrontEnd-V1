import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { map, Observable } from 'rxjs';

import { PermissionKey } from '../models/auth.models';
import { AuthService } from '../services/auth.service';
import { safeInternalReturnUrl } from '../utils/return-url';

function afterInitialization(
  check: (authService: AuthService, router: Router) => boolean | UrlTree,
): Observable<boolean | UrlTree> {
  const authService = inject(AuthService);
  const router = inject(Router);
  return authService.loadCurrentSession().pipe(map(() => check(authService, router)));
}

export const authGuard: CanActivateFn = (_route, state) =>
  afterInitialization((authService, router) => {
    if (authService.isAuthenticated()) return true;
    const returnUrl = safeInternalReturnUrl(state.url);
    return router.createUrlTree(['/login'], {
      queryParams: returnUrl ? { returnUrl } : undefined,
    });
  });

export const guestGuard: CanActivateFn = () =>
  afterInitialization((authService, router) => {
    if (!authService.isAuthenticated()) return true;
    if (authService.authStatus() === 'workspace_selection_required') {
      return router.createUrlTree(['/select-workspace']);
    }
    if (authService.authStatus() === 'onboarding_pending') {
      return router.createUrlTree(['/onboarding-pending']);
    }
    return router.createUrlTree(['/overview']);
  });

export const workspaceGuard: CanActivateFn = (_route, state) =>
  afterInitialization((authService, router) => {
    if (!authService.isAuthenticated()) {
      const returnUrl = safeInternalReturnUrl(state.url);
      return router.createUrlTree(['/login'], {
        queryParams: returnUrl ? { returnUrl } : undefined,
      });
    }
    if (authService.authStatus() === 'onboarding_pending') {
      return router.createUrlTree(['/onboarding-pending']);
    }
    if (authService.authStatus() === 'workspace_selection_required') {
      const returnUrl = safeInternalReturnUrl(state.url);
      return router.createUrlTree(['/select-workspace'], {
        queryParams: returnUrl ? { returnUrl } : undefined,
      });
    }
    return authService.authStatus() === 'workspace_selected'
      ? true
      : router.createUrlTree(['/login']);
  });

export const permissionGuard: CanActivateFn = (route) =>
  afterInitialization((authService, router) => {
    const required = (route.data['requiredPermissions'] ?? []) as PermissionKey[];
    const allowed =
      route.data['permissionMatch'] === 'any'
        ? authService.hasAnyPermission(required)
        : authService.hasEveryPermission(required);
    return allowed ? true : router.createUrlTree(['/access-denied']);
  });

export const workspaceSelectionGuard: CanActivateFn = () =>
  afterInitialization((authService, router) => {
    if (!authService.isAuthenticated()) return router.createUrlTree(['/login']);
    if (authService.authStatus() === 'workspace_selection_required') return true;
    if (authService.authStatus() === 'onboarding_pending') {
      return router.createUrlTree(['/onboarding-pending']);
    }
    return router.createUrlTree(['/overview']);
  });

export const onboardingGuard: CanActivateFn = () =>
  afterInitialization((authService, router) => {
    if (!authService.isAuthenticated()) return router.createUrlTree(['/login']);
    if (authService.authStatus() === 'onboarding_pending') return true;
    if (authService.authStatus() === 'workspace_selection_required') {
      return router.createUrlTree(['/select-workspace']);
    }
    return router.createUrlTree(['/overview']);
  });
