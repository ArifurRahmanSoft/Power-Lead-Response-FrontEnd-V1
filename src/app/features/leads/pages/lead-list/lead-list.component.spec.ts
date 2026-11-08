import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { API_CONFIG } from '../../../../core/config/api.config';
import { PermissionKey, PERMISSIONS, SelectedWorkspace } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { Lead } from '../../models/lead.models';
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
  items: WritableSignal<Lead[]>;
  total: WritableSignal<number>;
  selectedCount(): number;
  selectedOnPageCount(): number;
  allPageSelected(): boolean;
  pageSelectionIndeterminate(): boolean;
  selectionMode(): 'selected' | 'all_matching';
  selectionNotice(): string;
  notice(): string;
  convertedCustomerId(): string | null;
  canConvertLead(lead: Lead): boolean;
  conversionCandidate(): Lead | null;
  conversionError(): string;
  duplicateCustomerId(): string | null;
  openSetAsCustomer(lead: Lead): void;
  setAsCustomer(): void;
  emailStatusLabel(lead: Lead): string;
  emailStageLabel(lead: Lead): string;
  smsStatusLabel(lead: Lead): string;
  smsTypeLabel(lead: Lead): string;
  toggleLeadSelection(leadId: string, event: Event): void;
  togglePageSelection(event: Event): void;
  selectAllMatching(): void;
  clearSelection(message?: string): void;
  refreshEmailStatus(): void;
  refreshSmsStatus(): void;
  sendSelectedSms(): void;
  composeSmsRecipients(): ReadonlyArray<{ id: string; name: string; phone: string | null }>;
  composeSmsRecipientCount(): number;
}

describe('LeadListComponent service filter', () => {
  let http: HttpTestingController;
  let router: Router;
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let selectedWorkspace: WritableSignal<SelectedWorkspace | null>;
  let permissions: Set<PermissionKey>;

  beforeEach(() => {
    queryParams = new BehaviorSubject(convertToParamMap({ page: '3', company: 'Acme' }));
    selectedWorkspace = signal({ id: 'workspace-1', name: 'One', slug: 'one' });
    permissions = new Set();
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
            hasPermission: (permission: PermissionKey) => permissions.has(permission),
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

  it('renders the backend-paginated lead order without sorting the loaded page', () => {
    const { fixture } = createComponent();
    const serverOrderedItems = [
      {
        id: 'newest-lead',
        first_name: 'Zara',
        last_name: 'Newest',
        email: 'zara@example.com',
        created_at: '2026-11-07T12:00:00Z',
      },
      {
        id: 'older-lead',
        first_name: 'Aaron',
        last_name: 'Older',
        email: 'aaron@example.com',
        created_at: '2026-11-06T12:00:00Z',
      },
    ] as Lead[];
    http
      .expectOne(
        (request) =>
          request.url === `${API_CONFIG.baseUrl}/leads` && request.params.get('page') === '3',
      )
      .flush({
        success: true,
        data: { items: serverOrderedItems, page: 3, size: 20, total: 42 },
      });
    http.expectOne(`${API_CONFIG.baseUrl}/leads/service-requested-options?page=1&size=100`).flush({
      success: true,
      data: { items: [], page: 1, size: 100, total: 0 },
    });

    fixture.detectChanges();

    const names = Array.from(
      fixture.nativeElement.querySelectorAll('tbody tr td:nth-child(2) strong'),
      (element) => (element as HTMLElement).textContent?.trim(),
    );
    expect(names).toEqual(['Zara Newest', 'Aaron Older']);
    expect(fixture.nativeElement.querySelector('thead [aria-sort]')).toBeNull();
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

  it('selects arbitrary rows, supports page/all-matching scope, and clears visibly on filters', () => {
    const { component } = createComponent();
    flushInitialRequests();
    const leads = ['lead-1', 'lead-2', 'lead-3'].map((id, index) => ({
      id,
      first_name: `Lead ${index + 1}`,
      last_name: 'Person',
      email: `${id}@example.com`,
      email_summary: { state: 'not_contacted_by_email', stage: null, attempt_count: 0 },
    })) as Lead[];
    component.items.set(leads);
    component.total.set(12);

    component.toggleLeadSelection('lead-1', { target: { checked: true } } as unknown as Event);
    expect(component.selectedCount()).toBe(1);
    expect(component.pageSelectionIndeterminate()).toBe(true);

    component.togglePageSelection({ target: { checked: true } } as unknown as Event);
    expect(component.selectedCount()).toBe(3);
    expect(component.allPageSelected()).toBe(true);

    component.selectAllMatching();
    expect(component.selectionMode()).toBe('all_matching');
    expect(component.selectedCount()).toBe(12);
    expect(component.selectionNotice()).toContain('All 12 matching leads');

    component.toggleLeadSelection('lead-1', {
      target: { checked: false },
    } as unknown as Event);
    expect(component.selectedCount()).toBe(0);
    expect(component.selectionNotice()).toContain('deselected');
    component.togglePageSelection({ target: { checked: true } } as unknown as Event);
    component.selectAllMatching();

    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.filters.controls.status.setValue('qualified', { emitEvent: false });
    component.clearFilters();
    expect(component.selectedCount()).toBe(0);
    expect(component.selectionNotice()).toContain('filters changed');
    http.expectOne(`${API_CONFIG.baseUrl}/leads/service-requested-options?page=1&size=100`).flush({
      success: true,
      data: { items: [], page: 1, size: 100, total: 0 },
    });
  });

  it('refreshes lead email summaries after a batch status change', () => {
    const { component } = createComponent();
    flushInitialRequests();

    component.refreshEmailStatus();
    const refresh = http.expectOne(
      (request) =>
        request.url === `${API_CONFIG.baseUrl}/leads` && request.params.get('page') === '3',
    );
    refresh.flush({ success: true, data: { items: [], page: 3, size: 20, total: 0 } });
  });

  it('refreshes lead SMS summaries after send or status refresh', () => {
    const { component } = createComponent();
    flushInitialRequests();

    component.refreshSmsStatus();
    const refresh = http.expectOne(
      (request) =>
        request.url === `${API_CONFIG.baseUrl}/leads` && request.params.get('page') === '3',
    );
    refresh.flush({ success: true, data: { items: [], page: 3, size: 20, total: 0 } });
  });

  it('sends SMS only to explicitly selected rows retained across pages', () => {
    permissions.add(PERMISSIONS.mailSend);
    const { component } = createComponent();
    flushInitialRequests();
    const leadOne = {
      id: 'lead-1',
      first_name: 'First',
      last_name: 'Lead',
      phone: '+14155552671',
      email: 'first@example.com',
    } as Lead;
    const leadTwo = {
      id: 'lead-2',
      first_name: 'Second',
      last_name: 'Lead',
      phone: '+14155552672',
      email: 'second@example.com',
    } as Lead;

    component.items.set([leadOne]);
    component.toggleLeadSelection('lead-1', { target: { checked: true } } as unknown as Event);
    component.items.set([leadTwo]);
    component.toggleLeadSelection('lead-2', { target: { checked: true } } as unknown as Event);
    (component as unknown as { smsComposer: { openComposer(): void } }).smsComposer = {
      openComposer: vi.fn(),
    };
    component.sendSelectedSms();

    expect(component.composeSmsRecipientCount()).toBe(2);
    expect(component.composeSmsRecipients().map((recipient) => recipient.id)).toEqual([
      'lead-1',
      'lead-2',
    ]);
  });

  it('does not prepare an SMS request above the backend batch limit', () => {
    permissions.add(PERMISSIONS.mailSend);
    const { component } = createComponent();
    flushInitialRequests();
    component.items.set(
      Array.from({ length: 11 }, (_, index) => ({
        id: `lead-${index}`,
        first_name: 'Lead',
        last_name: `${index}`,
        phone: `+141555526${String(index).padStart(2, '0')}`,
        email: `lead-${index}@example.com`,
      })) as Lead[],
    );
    component.total.set(11);
    component.togglePageSelection({ target: { checked: true } } as unknown as Event);
    (component as unknown as { smsComposer: { openComposer(): void } }).smsComposer = {
      openComposer: vi.fn(),
    };

    component.sendSelectedSms();

    expect(component.composeSmsRecipientCount()).toBe(0);
    expect(component.selectionNotice()).toContain('up to 10 recipients');
  });

  it('keeps mail type separate from the backend send status', () => {
    const { component } = createComponent();
    flushInitialRequests();
    const leadWithUnknownOutcome = {
      id: 'lead-1',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      email_summary: {
        state: 'unknown',
        stage: 'follow_up',
        attempt_count: 1,
      },
    } as Lead;

    expect(component.emailStatusLabel(leadWithUnknownOutcome)).toBe('Unknown — uncertain outcome');
    expect(component.emailStageLabel(leadWithUnknownOutcome)).toBe('Follow Up');
  });

  it('handles missing SMS history and keeps provider status separate from message type', () => {
    const { component } = createComponent();
    flushInitialRequests();
    const lead = {
      id: 'lead-1',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
    } as Lead;

    expect(component.smsStatusLabel(lead)).toBe('No SMS history');
    expect(component.smsTypeLabel(lead)).toBe('—');

    lead.sms_summary = {
      provider_status: 'accepted',
      contact_type: 'second_follow_up',
      last_successful_at: '2026-10-18T00:00:00Z',
    };
    expect(component.smsStatusLabel(lead)).toBe('Accepted — not delivered');
    expect(component.smsTypeLabel(lead)).toBe('Second Follow Up');
  });

  it('sets NEW and CONTACTED leads as customers with the minimal payload and refreshes totals', () => {
    permissions.add(PERMISSIONS.customersView);
    const { fixture, component } = createComponent();
    flushInitialRequests();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const newLead = {
      id: 'lead-new',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      status: 'new',
      row_version: 7,
      can_convert_to_customer: true,
    } as Lead;
    const contacted = {
      ...newLead,
      id: 'lead-contacted',
      status: 'contacted',
    } as Lead;
    const disqualified = {
      ...newLead,
      id: 'lead-disqualified',
      status: 'disqualified',
      can_convert_to_customer: false,
    } as Lead;
    component.items.set([newLead, contacted, disqualified]);
    component.total.set(3);
    fixture.detectChanges();

    expect(component.canConvertLead(newLead)).toBe(true);
    expect(component.canConvertLead(contacted)).toBe(true);
    expect(component.canConvertLead(disqualified)).toBe(false);
    const rowActionText = [...fixture.nativeElement.querySelectorAll('.row-actions')]
      .map((actions: HTMLElement) => actions.textContent)
      .join(' ');
    expect(rowActionText).not.toContain('Set as Customer');
    expect(rowActionText).not.toContain('Send Email');
    expect(rowActionText).not.toContain('Send Message');

    component.toggleLeadSelection(newLead.id, {
      target: { checked: true },
    } as unknown as Event);
    fixture.detectChanges();
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    const setCustomerButtons = buttons.filter((button) =>
      button.textContent?.includes('Set as Customer'),
    );
    expect(setCustomerButtons).toHaveLength(1);
    expect(setCustomerButtons[0].disabled).toBe(false);

    component.toggleLeadSelection(contacted.id, {
      target: { checked: true },
    } as unknown as Event);
    fixture.detectChanges();
    expect(setCustomerButtons[0].isConnected).toBe(true);
    expect(setCustomerButtons[0].disabled).toBe(true);
    expect(setCustomerButtons[0].title).toContain('Select exactly one eligible lead');

    component.toggleLeadSelection(contacted.id, {
      target: { checked: false },
    } as unknown as Event);
    fixture.detectChanges();
    expect(setCustomerButtons[0].disabled).toBe(false);

    setCustomerButtons[0].click();
    fixture.detectChanges();
    expect(component.conversionCandidate()?.id).toBe(newLead.id);
    expect(fixture.nativeElement.textContent).toContain('Set Jane Doe as a customer?');
    expect(fixture.nativeElement.textContent).toContain(
      'This record will move from Leads to Customers. Its history will be preserved.',
    );

    component.setAsCustomer();
    component.setAsCustomer();

    const conversion = http.expectOne(`${API_CONFIG.baseUrl}/leads/${newLead.id}/convert`);
    expect(conversion.request.method).toBe('POST');
    expect(conversion.request.body).toEqual({ row_version: 7 });
    conversion.flush({
      success: true,
      message: 'Lead converted to customer',
      data: {
        customer: { id: 'customer-1' },
        conversion: { id: 'conversion-1' },
        idempotent_replay: false,
      },
    });
    http
      .expectOne(
        (request) =>
          request.url === `${API_CONFIG.baseUrl}/leads` && request.params.get('page') === '3',
      )
      .flush({ success: true, data: { items: [], page: 3, size: 20, total: 40 } });

    expect(component.conversionCandidate()).toBeNull();
    expect(component.convertedCustomerId()).toBe('customer-1');
    expect(component.notice()).toContain('Lead List has been refreshed');
    expect(component.selectedCount()).toBe(0);
    expect(component.total()).toBe(40);
    expect(navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { page: 2 },
      queryParamsHandling: 'merge',
    });
  });

  it('requires an explicit second confirmation to resolve a duplicate customer', () => {
    const { fixture, component } = createComponent();
    flushInitialRequests();
    const candidate = {
      id: 'lead-contacted',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      status: 'contacted',
      row_version: 4,
      can_convert_to_customer: true,
    } as Lead;
    component.openSetAsCustomer(candidate);
    component.setAsCustomer();
    http.expectOne(`${API_CONFIG.baseUrl}/leads/${candidate.id}/convert`).flush(
      {
        detail: {
          message: 'A customer with this email already exists; retry with link_existing',
          existing_customer_id: 'customer-existing',
        },
      },
      { status: 409, statusText: 'Conflict' },
    );

    expect(component.duplicateCustomerId()).toBe('customer-existing');
    http.expectNone(`${API_CONFIG.baseUrl}/leads/${candidate.id}/convert`);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Link Existing Customer');

    component.setAsCustomer();
    const retry = http.expectOne(`${API_CONFIG.baseUrl}/leads/${candidate.id}/convert`);
    expect(retry.request.body).toEqual({
      row_version: 4,
      duplicate_resolution: 'link_existing',
      existing_customer_id: 'customer-existing',
    });
    retry.flush({
      success: true,
      message: 'Lead converted to customer',
      data: {
        customer: { id: 'customer-existing' },
        conversion: { id: 'conversion-1' },
        idempotent_replay: false,
      },
    });
    http
      .expectOne((request) => request.url === `${API_CONFIG.baseUrl}/leads`)
      .flush({ success: true, data: { items: [], page: 3, size: 20, total: 0 } });
  });

  it('shows a returned conversion result only when customer viewing is authorized', () => {
    permissions.add(PERMISSIONS.customersView);
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({
      extras: {
        state: {
          leadConversion: {
            message: 'Lead converted. The lead list and selection were refreshed.',
            customerId: 'customer-1',
          },
        },
      },
    } as unknown as ReturnType<Router['getCurrentNavigation']>);

    const { fixture, component } = createComponent();
    flushInitialRequests();
    fixture.detectChanges();

    expect(component.notice()).toContain('selection were refreshed');
    expect(component.convertedCustomerId()).toBe('customer-1');
    const customerLink = fixture.nativeElement.querySelector(
      'a[href="/customers/customer-1"]',
    ) as HTMLAnchorElement | null;
    expect(customerLink?.textContent).toContain('View Customer');
  });
});
