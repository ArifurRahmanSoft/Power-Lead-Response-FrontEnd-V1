import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { API_CONFIG } from '../../../../core/config/api.config';
import { PERMISSIONS, PermissionKey } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { Customer } from '../../models/customer.models';
import { CustomerListComponent } from './customer-list.component';

describe('CustomerListComponent source rendering', () => {
  let fixture: ComponentFixture<CustomerListComponent>;
  let http: HttpTestingController;
  let permissions: WritableSignal<ReadonlySet<PermissionKey>>;

  beforeEach(() => {
    const queryParams = new BehaviorSubject(convertToParamMap({}));
    permissions = signal(new Set([PERMISSIONS.customersView]) as ReadonlySet<PermissionKey>);
    TestBed.configureTestingModule({
      imports: [CustomerListComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            hasPermission: (permission: PermissionKey) => permissions().has(permission),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: queryParams.asObservable() },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CustomerListComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  it('renders Direct, Lead, and unknown strictly from backend source_type', () => {
    const base = {
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      phone: null,
      company: 'Example Co',
      communication_purpose: 'customer_relationship',
      communication_consent_status: 'unknown' as const,
      channel_restrictions: [],
      suppressed_at: null,
      suppression_reason: null,
      created_at: '2026-10-15T04:00:00Z',
      row_version: 1,
    };
    const leadCustomer = {
      ...base,
      id: 'customer-lead',
      source_type: 'lead',
      source_lead_id: 'lead-1',
      source_lead_label: 'PL-001 · Jane Doe',
    } satisfies Customer;
    const directCustomer = {
      ...base,
      id: 'customer-direct',
      source_type: 'direct',
    } satisfies Customer;
    const legacyCustomer = { ...base, id: 'customer-legacy' } satisfies Customer;

    http.expectOne(`${API_CONFIG.baseUrl}/customers?page=1&size=20`).flush({
      success: true,
      data: {
        items: [leadCustomer, directCustomer, legacyCustomer],
        page: 1,
        size: 20,
        total: 3,
      },
    });
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLElement>;
    expect(rows[0].textContent).toContain('Lead');
    expect(rows[0].textContent).toContain('PL-001 · Jane Doe');
    expect(rows[1].textContent).toContain('Direct');
    expect(rows[2].textContent).toContain('Unknown');
    expect(rows[2].querySelector('.source-unknown')).not.toBeNull();
  });

  it('shows create and edit actions only with their finalized permissions', () => {
    http.expectOne(`${API_CONFIG.baseUrl}/customers?page=1&size=20`).flush({
      success: true,
      data: {
        items: [
          {
            id: 'customer-1',
            first_name: 'Jane',
            last_name: 'Doe',
            email: 'jane@example.com',
            communication_purpose: 'customer_relationship',
            communication_consent_status: 'unknown',
            channel_restrictions: [],
            suppressed_at: null,
            suppression_reason: null,
            created_at: '2026-10-15T04:00:00Z',
            row_version: 1,
            source_type: 'direct',
          },
        ],
        page: 1,
        size: 20,
        total: 1,
      },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Add Customer');
    expect(fixture.nativeElement.querySelector('a[href="/customers/customer-1/edit"]')).toBeNull();

    permissions.set(
      new Set([
        PERMISSIONS.customersView,
        PERMISSIONS.customersCreate,
        PERMISSIONS.customersUpdate,
      ]),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Add Customer');
    expect(
      fixture.nativeElement.querySelector('a[href="/customers/customer-1/edit"]'),
    ).not.toBeNull();
  });
});
