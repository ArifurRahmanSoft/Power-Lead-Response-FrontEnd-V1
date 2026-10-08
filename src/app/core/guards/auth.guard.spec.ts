import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { firstValueFrom, Observable, of } from 'rxjs';

import { onboardingGuard, permissionGuard, workspaceGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

class FakeAuthService {
  authenticated = true;
  status: 'workspace_selected' | 'workspace_selection_required' | 'onboarding_pending' =
    'workspace_selected';
  permission = false;

  loadCurrentSession() {
    return of(this.authenticated);
  }
  isAuthenticated() {
    return this.authenticated;
  }
  authStatus() {
    return this.status;
  }
  hasEveryPermission() {
    return this.permission;
  }
  hasAnyPermission() {
    return this.permission;
  }
}

describe('auth guards', () => {
  let auth: FakeAuthService;

  beforeEach(() => {
    auth = new FakeAuthService();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });
  });

  it('redirects direct forbidden-route navigation to access denied', async () => {
    const route = {
      data: { requiredPermissions: ['settings.users.view'] },
    } as unknown as ActivatedRouteSnapshot;
    const result = TestBed.runInInjectionContext(() =>
      permissionGuard(route, { url: '/users' } as RouterStateSnapshot),
    ) as Observable<boolean | UrlTree>;

    expect(TestBed.inject(Router).serializeUrl((await firstValueFrom(result)) as UrlTree)).toBe(
      '/access-denied',
    );
  });

  it('sends authenticated users without membership to onboarding pending', async () => {
    auth.status = 'onboarding_pending';
    const result = TestBed.runInInjectionContext(() =>
      workspaceGuard({} as ActivatedRouteSnapshot, { url: '/leads' } as RouterStateSnapshot),
    ) as Observable<boolean | UrlTree>;

    expect(TestBed.inject(Router).serializeUrl((await firstValueFrom(result)) as UrlTree)).toBe(
      '/onboarding-pending',
    );
  });

  it('preserves a safe internal return URL for workspace selection', async () => {
    auth.status = 'workspace_selection_required';
    const result = TestBed.runInInjectionContext(() =>
      workspaceGuard(
        {} as ActivatedRouteSnapshot,
        { url: '/leads?view=mine' } as RouterStateSnapshot,
      ),
    ) as Observable<boolean | UrlTree>;

    expect(TestBed.inject(Router).serializeUrl((await firstValueFrom(result)) as UrlTree)).toBe(
      '/select-workspace?returnUrl=%2Fleads%3Fview%3Dmine',
    );
  });

  it('exits onboarding when the current backend session has a selected workspace', async () => {
    auth.status = 'workspace_selected';
    const result = TestBed.runInInjectionContext(() =>
      onboardingGuard(
        {} as ActivatedRouteSnapshot,
        { url: '/onboarding-pending' } as RouterStateSnapshot,
      ),
    ) as Observable<boolean | UrlTree>;

    expect(TestBed.inject(Router).serializeUrl((await firstValueFrom(result)) as UrlTree)).toBe(
      '/overview',
    );
  });
});
