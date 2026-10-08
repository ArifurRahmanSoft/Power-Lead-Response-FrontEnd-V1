import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { API_CONFIG } from '../../../../core/config/api.config';
import { SelectedWorkspace } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { LeadListComponent } from './lead-list.component';

interface ExposedLeadList {
  filters: FormGroup<{
    search: FormControl<string>;
    company: FormControl<string>;
    country: FormControl<string>;
    industry: FormControl<string>;
    serviceRequested: FormControl<string>;
    status: FormControl<string>;
    emailStatus: FormControl<string>;
    source: FormControl<string>;
    assignedUserId: FormControl<string>;
  }>;
  serviceOptionSearch: FormControl<string>;
  serviceOptions(): Array<{ label: string; value: string }>;
  serviceOptionsLoading(): boolean;
  serviceOptionsError(): string;
  clearFilters(): void;
  retryServiceOptions(): void;
}

describe('LeadListComponent service filter', () => {
  let http: HttpTestingController;
  let router: Router;
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let selectedWorkspace: WritableSignal<SelectedWorkspace | null>;

  beforeEach(() => {
    queryParams = new BehaviorSubject(convertToParamMap({ page: '3', company: 'Acme' }));
    selectedWorkspace = signal({ id: 'workspace-1', name: 'One', slug: 'one' });
    TestBed.configureTestingModule({
      imports: [LeadListComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: queryParams.asObservable() },
        },
        {
          provide: AuthService,
          useValue: {
            selectedWorkspace,
            hasPermission: () => false,
          },
        },
        { provide: SettingsService, useValue: {} },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  function createComponent(): {
    fixture: ComponentFixture<LeadListComponent>;
    component: ExposedLeadList;
  } {
    const fixture = TestBed.createComponent(LeadListComponent);
    fixture.detectChanges();
    return {
      fixture,
      component: fixture.componentInstance as unknown as ExposedLeadList,
    };
  }

  function flushInitialRequests(): void {
    http
      .expectOne(
        (request) =>
          request.url === `${API_CONFIG.baseUrl}/leads` && request.params.get('page') === '3',
      )
      .flush({ success: true, data: { items: [], page: 3, size: 20, total: 0 } });
    http.expectOne(`${API_CONFIG.baseUrl}/leads/service-requested-options?page=1&size=100`).flush({
      success: true,
      data: {
        items: [
          { label: 'SEO', value: 'seo' },
          { label: 'Website Design', value: 'website design' },
        ],
        page: 1,
        size: 100,
        total: 2,
      },
    });
  }

  it('persists selection with combined filters, resets page, and removes All services', () => {
    const { component } = createComponent();
    flushInitialRequests();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.filters.patchValue(
      { search: 'Jane', country: 'Bangladesh', status: 'qualified' },
      { emitEvent: false },
    );

    component.filters.controls.serviceRequested.setValue('website design');
    expect(navigate).toHaveBeenLastCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: expect.objectContaining({
        page: 1,
        search: 'Jane',
        company: 'Acme',
        country: 'Bangladesh',
        service_requested: 'website design',
        status: 'qualified',
      }),
      queryParamsHandling: 'merge',
    });

    component.filters.controls.serviceRequested.setValue('');
    expect(navigate).toHaveBeenLastCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: expect.objectContaining({ page: 1, service_requested: null }),
      queryParamsHandling: 'merge',
    });
  });

  it('clears the service filter with Reset filters', () => {
    const { component } = createComponent();
    flushInitialRequests();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.filters.controls.serviceRequested.setValue('seo', { emitEvent: false });
    component.serviceOptionSearch.setValue('se', { emitEvent: false });

    component.clearFilters();

    expect(component.filters.controls.serviceRequested.value).toBe('');
    expect(component.serviceOptionSearch.value).toBe('');
    expect(navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: {},
    });
    http.expectOne(`${API_CONFIG.baseUrl}/leads/service-requested-options?page=1&size=100`).flush({
      success: true,
      data: { items: [], page: 1, size: 100, total: 0 },
    });
  });

  it('cancels stale lead-list requests when route filters change quickly', () => {
    createComponent();
    const first = http.expectOne(
      (request) =>
        request.url === `${API_CONFIG.baseUrl}/leads` && request.params.get('page') === '3',
    );
    http.expectOne(`${API_CONFIG.baseUrl}/leads/service-requested-options?page=1&size=100`).flush({
      success: true,
      data: { items: [], page: 1, size: 100, total: 0 },
    });

    queryParams.next(convertToParamMap({ page: '1', service_requested: 'seo' }));
    expect(first.cancelled).toBe(true);
    const latest = http.expectOne(
      (request) =>
        request.url === `${API_CONFIG.baseUrl}/leads` &&
        request.params.get('page') === '1' &&
        request.params.get('service_requested') === 'seo',
    );
    latest.flush({ success: true, data: { items: [], page: 1, size: 20, total: 0 } });
  });

  it('shows empty/error states, retries, and clears workspace-specific state', () => {
    const { fixture, component } = createComponent();
    http
      .expectOne(
        (request) =>
          request.url === `${API_CONFIG.baseUrl}/leads` && request.params.get('page') === '3',
      )
      .flush({ success: true, data: { items: [], page: 3, size: 20, total: 0 } });
    expect(component.serviceOptionsLoading()).toBe(true);
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/service-requested-options?page=1&size=100`)
      .flush('failed', { status: 500, statusText: 'Server Error' });
    expect(component.serviceOptions()).toEqual([]);
    expect(component.serviceOptionsError()).toBe('failed');

    component.retryServiceOptions();
    http.expectOne(`${API_CONFIG.baseUrl}/leads/service-requested-options?page=1&size=100`).flush({
      success: true,
      data: { items: [], page: 1, size: 100, total: 0 },
    });
    expect(component.serviceOptions()).toEqual([]);
    expect(component.serviceOptionsError()).toBe('');

    component.filters.controls.serviceRequested.setValue('seo', { emitEvent: false });
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    selectedWorkspace.set({ id: 'workspace-2', name: 'Two', slug: 'two' });
    fixture.detectChanges();

    expect(component.filters.controls.serviceRequested.value).toBe('');
    expect(component.serviceOptions()).toEqual([]);
    expect(navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { page: 1, service_requested: null },
      queryParamsHandling: 'merge',
    });
    http.expectOne(`${API_CONFIG.baseUrl}/leads/service-requested-options?page=1&size=100`).flush({
      success: true,
      data: { items: [{ label: 'Consulting', value: 'consulting' }], page: 1, size: 100, total: 1 },
    });
  });
});
