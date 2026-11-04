import {
  Component,
  DestroyRef,
  OnChanges,
  SimpleChanges,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { PERMISSIONS } from '../../../../core/models/auth.models';
import { SettingsUser } from '../../../../core/models/settings.models';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import {
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  catalogLabel,
  countryName,
} from '../../../leads/models/lead-catalogs';
import {
  COMPANY_SIZES,
  CONSENT_STATUSES,
  CompanySize,
  ConsentStatus,
  REVENUE_PERIODS,
  RevenuePeriod,
} from '../../../leads/models/lead.models';
import { leadErrorDetails } from '../../../leads/services/lead-errors';
import { optionalLeadUrlValidator } from '../../../leads/validators/lead-url.validator';
import {
  Customer,
  CustomerCreateRequest,
  CustomerFieldsDto,
  CustomerUpdateRequest,
} from '../../models/customer.models';
import { CustomersService } from '../../services/customers.service';

const relatedFieldsValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const amount = String(control.get('revenueAmount')?.value || '').trim();
  const currency = String(control.get('revenueCurrency')?.value || '').trim();
  const period = String(control.get('revenuePeriod')?.value || '').trim();
  const revenueIncomplete =
    [amount, currency, period].some(Boolean) && ![amount, currency, period].every(Boolean);
  return revenueIncomplete ? { revenueIncomplete: true } : null;
};

@Component({
  selector: 'app-customer-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './customer-form.component.html',
})
export class CustomerFormComponent implements OnChanges {
  readonly customer = input<Customer | null>(null);
  readonly saved = output<Customer>();
  readonly cancelled = output<void>();

  private readonly customers = inject(CustomersService);
  private readonly settings = inject(SettingsService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly saving = signal(false);
  protected readonly message = signal('');
  protected readonly duplicateCustomerId = signal<string | null>(null);
  protected readonly stale = signal(false);
  protected readonly sameAsContact = signal(false);
  protected readonly serverFieldErrors = signal<Record<string, string>>({});
  protected readonly loadingAssignees = signal(false);
  protected readonly assignees = signal<SettingsUser[]>([]);
  protected readonly assigneeLoadError = signal('');
  protected readonly originalAssigneeId = signal<string | null>(null);
  protected readonly countryOptions = COUNTRY_OPTIONS;
  protected readonly currencyOptions = CURRENCY_OPTIONS;
  protected readonly companySizes = COMPANY_SIZES;
  protected readonly revenuePeriods = REVENUE_PERIODS;
  protected readonly consentStatuses = CONSENT_STATUSES;
  protected readonly label = catalogLabel;

  protected readonly form = new FormGroup(
    {
      firstName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(120)],
      }),
      lastName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(120)],
      }),
      email: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.email],
      }),
      designation: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(160)],
      }),
      company: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
      country: new FormControl('', { nonNullable: true }),
      phone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
      whatsappNumber: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(32)],
      }),
      city: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] }),
      state: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] }),
      linkedinUrl: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(2048), optionalLeadUrlValidator],
      }),
      facebookUrl: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(2048), optionalLeadUrlValidator],
      }),
      instagramUrl: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(2048), optionalLeadUrlValidator],
      }),
      xUrl: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(2048), optionalLeadUrlValidator],
      }),
      githubUrl: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(2048), optionalLeadUrlValidator],
      }),
      companyWebsite: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(2048), optionalLeadUrlValidator],
      }),
      industry: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(160)] }),
      serviceRequested: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(200)],
      }),
      companySize: new FormControl<CompanySize | ''>('', { nonNullable: true }),
      revenueAmount: new FormControl('', {
        nonNullable: true,
        validators: [Validators.min(0), Validators.pattern(/^\d{1,16}(\.\d{1,2})?$/)],
      }),
      revenueCurrency: new FormControl('', {
        nonNullable: true,
        validators: [Validators.pattern(/^[A-Za-z]{3}$/)],
      }),
      revenuePeriod: new FormControl<RevenuePeriod | ''>('', { nonNullable: true }),
      notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(10000)] }),
      assignedUserId: new FormControl('', {
        nonNullable: true,
        validators: [
          Validators.pattern(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
        ],
      }),
      consentStatus: new FormControl<ConsentStatus>('unknown', { nonNullable: true }),
      consentReference: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(255)],
      }),
    },
    { validators: relatedFieldsValidator },
  );

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (Object.keys(this.serverFieldErrors()).length) this.clearServerErrors();
    });
    this.form.controls.phone.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((phone) => {
        if (!this.sameAsContact()) return;
        this.form.controls.whatsappNumber.setValue(phone, { emitEvent: false });
        this.form.controls.whatsappNumber.markAsDirty();
      });
    if (this.canAssign() && this.auth.hasPermission(PERMISSIONS.settingsUsersView)) {
      this.loadAssignees();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['customer']) this.populate(this.customer());
  }

  public hasUnsavedChanges(): boolean {
    return this.form.dirty && !this.saving();
  }

  protected toggleSameAsContact(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    if (!checkbox.checked) {
      this.sameAsContact.set(false);
      return;
    }
    const phone = this.form.controls.phone.value;
    const whatsapp = this.form.controls.whatsappNumber.value;
    if (
      whatsapp.trim() &&
      whatsapp.trim() !== phone.trim() &&
      typeof window !== 'undefined' &&
      !window.confirm('Replace the current WhatsApp number with the contact number?')
    ) {
      checkbox.checked = false;
      return;
    }
    this.sameAsContact.set(true);
    this.form.controls.whatsappNumber.setValue(phone);
    this.form.controls.whatsappNumber.markAsDirty();
  }

  protected submit(): void {
    if (this.saving()) return;
    this.clearServerErrors();
    if (!this.canSaveCustomer()) {
      this.message.set('Your role does not have permission to save this customer.');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.message.set('Review the highlighted fields before saving.');
      return;
    }
    const current = this.customer();
    const fields = this.toDto();
    const operation = current
      ? this.customers.update(current.id, {
          ...fields,
          row_version: current.row_version,
        } satisfies CustomerUpdateRequest)
      : this.customers.create(fields satisfies CustomerCreateRequest);
    this.saving.set(true);
    this.message.set('');
    this.duplicateCustomerId.set(null);
    this.stale.set(false);
    operation
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.form.markAsPristine();
          this.saved.emit(data);
        },
        error: (error: unknown) => this.handleError(error),
      });
  }

  protected fieldError(controlName: keyof typeof this.form.controls): string {
    const control = this.form.controls[controlName];
    const serverError = this.serverFieldErrors()[controlName];
    if (serverError) return serverError;
    if (!(control.touched || control.dirty) || !control.errors) return '';
    const labels: Partial<Record<keyof typeof this.form.controls, string>> = {
      firstName: 'First name',
      lastName: 'Last name',
      email: 'Email',
      phone: 'Phone',
      whatsappNumber: 'WhatsApp number',
      revenueAmount: 'Revenue amount',
      revenueCurrency: 'Revenue currency',
      assignedUserId: 'Assignee',
    };
    const label = labels[controlName] || 'This field';
    if (control.hasError('required')) return `${label} is required.`;
    if (control.hasError('email')) return 'Enter a valid email address.';
    if (control.hasError('url')) return 'Enter a valid domain or HTTP/HTTPS URL.';
    if (control.hasError('maxlength')) return `${label} is too long.`;
    if (control.hasError('min')) return 'Revenue cannot be negative.';
    if (control.hasError('pattern')) {
      if (controlName === 'revenueCurrency') return 'Use a three-letter ISO currency code.';
      if (controlName === 'assignedUserId') return 'Enter a valid user UUID.';
      return 'Use up to 16 digits and no more than 2 decimal places.';
    }
    return 'Check this value.';
  }

  protected canAssign(): boolean {
    return this.auth.hasPermission(PERMISSIONS.leadsAssign);
  }

  protected canChooseAssignee(): boolean {
    return this.canAssign() && this.auth.hasPermission(PERMISSIONS.settingsUsersView);
  }

  protected originalAssigneeResolved(): boolean {
    const original = this.originalAssigneeId();
    return !original || this.assignees().some((user) => user.id === original);
  }

  protected canSaveCustomer(): boolean {
    return this.auth.hasPermission(
      this.customer() ? PERMISSIONS.customersUpdate : PERMISSIONS.customersCreate,
    );
  }

  private toDto(): CustomerFieldsDto {
    const value = this.form.getRawValue();
    const optional = (input: string): string | null => input.trim() || null;
    const fields: CustomerFieldsDto = {
      first_name: value.firstName.trim().replace(/\s+/g, ' '),
      last_name: value.lastName.trim().replace(/\s+/g, ' '),
      email: value.email.trim().toLowerCase(),
      designation: optional(value.designation),
      company: optional(value.company),
      country: optional(countryName(value.country)),
      phone: optional(value.phone),
      whatsapp_number: optional(value.whatsappNumber),
      city: optional(value.city),
      state: optional(value.state),
      linkedin_url: optional(value.linkedinUrl),
      facebook_url: optional(value.facebookUrl),
      instagram_url: optional(value.instagramUrl),
      x_url: optional(value.xUrl),
      github_url: optional(value.githubUrl),
      company_website: optional(value.companyWebsite),
      industry: optional(value.industry),
      service_requested: optional(value.serviceRequested),
      company_size: value.companySize || null,
      revenue_amount: optional(value.revenueAmount),
      revenue_currency: optional(value.revenueCurrency)?.toUpperCase() || null,
      revenue_period: value.revenuePeriod || null,
      notes: optional(value.notes),
      communication_consent_status: value.consentStatus,
      consent_reference: optional(value.consentReference),
    };
    if (this.canAssign()) fields.assigned_user_id = optional(value.assignedUserId);
    return fields;
  }

  private populate(customer: Customer | null): void {
    this.sameAsContact.set(false);
    if (!customer) {
      this.originalAssigneeId.set(null);
      this.form.reset({ consentStatus: 'unknown' });
      return;
    }
    this.originalAssigneeId.set(customer.assigned_user_id || null);
    this.form.reset({
      firstName: customer.first_name,
      lastName: customer.last_name,
      email: customer.email,
      designation: customer.designation || '',
      company: customer.company || '',
      country: countryName(customer.country),
      phone: customer.phone || '',
      whatsappNumber: customer.whatsapp_number || '',
      city: customer.city || '',
      state: customer.state || '',
      linkedinUrl: customer.linkedin_url || '',
      facebookUrl: customer.facebook_url || '',
      instagramUrl: customer.instagram_url || '',
      xUrl: customer.x_url || '',
      githubUrl: customer.github_url || '',
      companyWebsite: customer.company_website || '',
      industry: customer.industry || '',
      serviceRequested: customer.service_requested || '',
      companySize: customer.company_size || '',
      revenueAmount: customer.revenue_amount || '',
      revenueCurrency: customer.revenue_currency || '',
      revenuePeriod: customer.revenue_period || '',
      notes: customer.notes || '',
      assignedUserId: customer.assigned_user_id || '',
      consentStatus: customer.communication_consent_status,
      consentReference: customer.consent_reference || '',
    });
  }

  private loadAssignees(page = 1, accumulated: SettingsUser[] = []): void {
    if (page === 1) {
      this.loadingAssignees.set(true);
      this.assigneeLoadError.set('');
    }
    this.settings
      .listUsers(page, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          const users = [...accumulated, ...data.items].filter((user) => user.is_active);
          this.assignees.set(users);
          if (data.page * data.size < data.total) {
            this.loadAssignees(data.page + 1, users);
          } else {
            this.loadingAssignees.set(false);
          }
        },
        error: () => {
          this.loadingAssignees.set(false);
          this.assigneeLoadError.set(
            'Eligible users could not be loaded. Reload before assigning.',
          );
        },
      });
  }

  private clearServerErrors(): void {
    if (!Object.keys(this.serverFieldErrors()).length) return;
    for (const control of Object.values(this.form.controls)) {
      if (!control.errors?.['server']) continue;
      const { server: _server, ...remaining } = control.errors;
      control.setErrors(Object.keys(remaining).length ? remaining : null, { emitEvent: false });
    }
    this.serverFieldErrors.set({});
  }

  private handleError(error: unknown): void {
    const details = leadErrorDetails(
      error,
      `Unable to ${this.customer() ? 'update' : 'create'} the customer.`,
    );
    this.message.set(details.message);
    this.duplicateCustomerId.set(details.existingCustomerId || null);
    this.stale.set(details.stale);
    const controlMap: Record<string, keyof typeof this.form.controls> = {
      first_name: 'firstName',
      last_name: 'lastName',
      email: 'email',
      designation: 'designation',
      company: 'company',
      country: 'country',
      phone: 'phone',
      whatsapp_number: 'whatsappNumber',
      city: 'city',
      state: 'state',
      linkedin_url: 'linkedinUrl',
      facebook_url: 'facebookUrl',
      instagram_url: 'instagramUrl',
      x_url: 'xUrl',
      github_url: 'githubUrl',
      company_website: 'companyWebsite',
      industry: 'industry',
      service_requested: 'serviceRequested',
      company_size: 'companySize',
      revenue_amount: 'revenueAmount',
      revenue_currency: 'revenueCurrency',
      revenue_period: 'revenuePeriod',
      notes: 'notes',
      assigned_user_id: 'assignedUserId',
      communication_consent_status: 'consentStatus',
      consent_reference: 'consentReference',
    };
    const fieldErrors: Record<string, string> = {};
    for (const [field, message] of Object.entries(details.fieldErrors)) {
      const controlName = controlMap[field];
      if (!controlName) continue;
      fieldErrors[controlName] = message;
      const control = this.form.controls[controlName];
      control.setErrors({ ...control.errors, server: message });
      control.markAsTouched();
    }
    this.serverFieldErrors.set(fieldErrors);
  }
}
