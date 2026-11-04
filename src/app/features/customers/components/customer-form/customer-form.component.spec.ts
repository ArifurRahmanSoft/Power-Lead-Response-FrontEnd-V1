import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';

import { API_CONFIG } from '../../../../core/config/api.config';
import { PERMISSIONS, PermissionKey } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { Customer } from '../../models/customer.models';
import { CustomerFormComponent } from './customer-form.component';

interface ExposedCustomerForm {
  form: FormGroup;
  message(): string;
  stale(): boolean;
  sameAsContact(): boolean;
  duplicateCustomerId(): string | null;
  submit(): void;
  hasUnsavedChanges(): boolean;
}

const existingCustomer: Customer = {
  id: 'customer-1',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  company: 'Example Co',
  phone: '+8801711111111',
  whatsapp_number: '+8801722222222',
  country: 'Bangladesh',
  assigned_user_id: '11111111-1111-4111-8111-111111111111',
  communication_purpose: 'customer_relationship',
  communication_consent_status: 'unknown',
  channel_restrictions: [],
  suppressed_at: null,
  suppression_reason: null,
  source_type: 'direct',
  source_lead_id: null,
  created_at: '2026-11-03T00:00:00Z',
  row_version: 4,
};

describe('CustomerFormComponent', () => {
  let fixture: ComponentFixture<CustomerFormComponent>;
  let component: ExposedCustomerForm;
  let http: HttpTestingController;
  let permissions: WritableSignal<ReadonlySet<PermissionKey>>;

  beforeEach(() => {
    permissions = signal(
      new Set([
        PERMISSIONS.customersCreate,
        PERMISSIONS.customersUpdate,
      ]) as ReadonlySet<PermissionKey>,
    );
    TestBed.configureTestingModule({
      imports: [CustomerFormComponent],
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
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CustomerFormComponent);
    component = fixture.componentInstance as unknown as ExposedCustomerForm;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    vi.restoreAllMocks();
  });

  function input(name: string): HTMLInputElement {
    return fixture.nativeElement.querySelector(`[formControlName="${name}"]`) as HTMLInputElement;
  }

  function enter(name: string, value: string): void {
    const field = input(name);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function fillRequired(): void {
    enter('firstName', ' Jane ');
    enter('lastName', ' Doe ');
    enter('email', 'JANE@EXAMPLE.COM');
  }

  it('requires explicit WhatsApp synchronization, confirms overwrite, and stops after unchecking', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    enter('phone', '01711111111');
    enter('whatsappNumber', '01999999999');
    const checkbox = fixture.nativeElement.querySelector(
      '.same-as-contact-control input',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(confirm).toHaveBeenCalledOnce();
    expect(component.sameAsContact()).toBe(false);
    expect(checkbox.checked).toBe(false);
    expect(input('whatsappNumber').value).toBe('01999999999');

    confirm.mockReturnValue(true);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(component.sameAsContact()).toBe(true);
    expect(input('whatsappNumber').readOnly).toBe(true);
    expect(input('whatsappNumber').value).toBe('01711111111');

    enter('phone', '01722222222');
    expect(input('whatsappNumber').value).toBe('01722222222');

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    enter('phone', '01733333333');
    expect(component.sameAsContact()).toBe(false);
    expect(input('whatsappNumber').readOnly).toBe(false);
    expect(input('whatsappNumber').value).toBe('01722222222');
  });

  it('creates a direct customer once without conversion, origin, checkbox, or messaging fields', () => {
    fillRequired();
    enter('phone', '+8801711111111');
    const checkbox = fixture.nativeElement.querySelector(
      '.same-as-contact-control input',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);

    component.submit();
    component.submit();
    const requests = http.match(`${API_CONFIG.baseUrl}/customers`);
    expect(requests).toHaveLength(1);
    expect(requests[0].request.method).toBe('POST');
    expect(requests[0].request.body).toMatchObject({
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      phone: '+8801711111111',
      whatsapp_number: '+8801711111111',
      communication_consent_status: 'unknown',
    });
    expect(requests[0].request.body).not.toHaveProperty('sameAsContact');
    expect(requests[0].request.body).not.toHaveProperty('source_type');
    expect(requests[0].request.body).not.toHaveProperty('source_lead_id');
    expect(requests[0].request.body).not.toHaveProperty('consent_evidence');
    expect(requests[0].request.url).not.toMatch(/convert|mail|message|send/);
    requests[0].flush({
      success: true,
      message: 'Customer created',
      data: { ...existingCustomer, id: 'customer-new', whatsapp_number: '+8801711111111' },
    });

    expect(saved).toHaveBeenCalledOnce();
    expect(component.hasUnsavedChanges()).toBe(false);
  });

  it('keeps values on validation and duplicate failures and links the existing customer', () => {
    component.submit();
    expect(component.message()).toContain('Review the highlighted fields');
    http.expectNone(`${API_CONFIG.baseUrl}/customers`);

    fillRequired();
    component.submit();
    http.expectOne(`${API_CONFIG.baseUrl}/customers`).flush(
      {
        detail: {
          message: 'A customer with this email already exists',
          existing_customer_id: 'customer-existing',
        },
      },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    expect(component.duplicateCustomerId()).toBe('customer-existing');
    expect(component.form.get('email')?.value).toBe('JANE@EXAMPLE.COM');
    expect(
      fixture.nativeElement.querySelector('a[href="/customers/customer-existing"]'),
    ).not.toBeNull();
  });

  it('patches an edit with row_version, preserves origin metadata, and reports stale conflicts', () => {
    fixture.componentRef.setInput('customer', existingCustomer);
    fixture.detectChanges();
    enter('company', 'Updated Co');

    component.submit();
    const update = http.expectOne(`${API_CONFIG.baseUrl}/customers/${existingCustomer.id}`);
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body.row_version).toBe(4);
    expect(update.request.body.company).toBe('Updated Co');
    expect(update.request.body).not.toHaveProperty('source_type');
    expect(update.request.body).not.toHaveProperty('source_lead_id');
    expect(update.request.body).not.toHaveProperty('assigned_user_id');
    update.flush('Customer was modified by another request', {
      status: 409,
      statusText: 'Conflict',
    });
    fixture.detectChanges();

    expect(component.stale()).toBe(true);
    expect(component.form.get('company')?.value).toBe('Updated Co');
    expect(component.hasUnsavedChanges()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Reload this page');
  });

  it('disables saving without the matching finalized permission', () => {
    permissions.set(new Set());
    fixture.detectChanges();
    const save = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('cannot save customer changes');
  });
});
