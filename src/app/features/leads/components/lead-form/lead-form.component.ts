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
import { LeadVoiceInputComponent } from '../lead-voice-input/lead-voice-input.component';
import {
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  catalogLabel,
  countryName,
} from '../../models/lead-catalogs';
import {
  COMPANY_SIZES,
  CONSENT_STATUSES,
  CompanySize,
  ConsentStatus,
  EMAIL_STATUSES,
  EmailStatus,
  Lead,
  LeadCreateRequest,
  LeadFieldsDto,
  REVENUE_PERIODS,
  RevenuePeriod,
} from '../../models/lead.models';
import { LeadVoiceFieldName, LeadVoiceFormValues } from '../../models/lead-voice.models';
import { leadErrorDetails } from '../../services/lead-errors';
import { LeadsService } from '../../services/leads.service';
import { optionalLeadUrlValidator } from '../../validators/lead-url.validator';

const relatedFieldsValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const amount = String(control.get('revenueAmount')?.value || '').trim();
  const currency = String(control.get('revenueCurrency')?.value || '').trim();
  const period = String(control.get('revenuePeriod')?.value || '').trim();
  const revenueIncomplete =
    [amount, currency, period].some(Boolean) && ![amount, currency, period].every(Boolean);
  const granted = control.get('consentStatus')?.value === 'granted';
  const hasConsentProof = Boolean(
    String(control.get('consentEvidence')?.value || '').trim() ||
    String(control.get('consentReference')?.value || '').trim(),
  );
  return {
    ...(revenueIncomplete ? { revenueIncomplete: true } : {}),
    ...(granted && !hasConsentProof ? { consentProofRequired: true } : {}),
  };
};

const VOICE_FIELD_FORM_MAP = {
  first_name: 'firstName',
  last_name: 'lastName',
  email: 'email',
  phone: 'phone',
  country: 'country',
  designation: 'designation',
  company: 'company',
  city: 'city',
  state: 'state',
  company_website: 'companyWebsite',
  industry: 'industry',
  company_size: 'companySize',
  revenue_amount: 'revenueAmount',
  revenue_currency: 'revenueCurrency',
  revenue_period: 'revenuePeriod',
  linkedin_url: 'linkedinUrl',
  facebook_url: 'facebookUrl',
  instagram_url: 'instagramUrl',
  x_url: 'xUrl',
  github_url: 'githubUrl',
  service_requested: 'serviceRequested',
  notes: 'notes',
} as const satisfies Record<LeadVoiceFieldName, string>;

const VOICE_FIELD_LABELS: Record<LeadVoiceFieldName, string> = {
  first_name: 'First Name',
  last_name: 'Last Name',
  email: 'Email',
  phone: 'Phone',
  country: 'Country',
  designation: 'Designation',
  company: 'Company',
  city: 'City',
  state: 'State / region',
  company_website: 'Company Website',
  industry: 'Industry',
  company_size: 'Company Size',
  revenue_amount: 'Revenue Amount',
  revenue_currency: 'Revenue Currency',
  revenue_period: 'Revenue Period',
  linkedin_url: 'LinkedIn URL',
  facebook_url: 'Facebook URL',
  instagram_url: 'Instagram URL',
  x_url: 'X URL',
  github_url: 'GitHub URL',
  service_requested: 'Service Requested',
  notes: 'Notes',
};

interface VoiceOverwriteConflict {
  field: LeadVoiceFieldName;
  label: string;
  current: string;
  proposed: string;
}

@Component({
  selector: 'app-lead-form',
  imports: [ReactiveFormsModule, RouterLink, LeadVoiceInputComponent],
  templateUrl: './lead-form.component.html',
})
export class LeadFormComponent implements OnChanges {
  readonly lead = input<Lead | null>(null);
  readonly saved = output<Lead>();
  readonly cancelled = output<void>();

  private readonly leads = inject(LeadsService);
  private readonly settings = inject(SettingsService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly permissions = PERMISSIONS;
  protected readonly saving = signal(false);
  protected readonly loadingAssignees = signal(false);
  protected readonly assignees = signal<SettingsUser[]>([]);
  protected readonly message = signal('');
  protected readonly duplicate = signal<{ id: string; tracking_id: string } | null>(null);
  protected readonly stale = signal(false);
  protected readonly voiceNotice = signal('');
  protected readonly voiceConflicts = signal<VoiceOverwriteConflict[]>([]);
  protected readonly pendingVoicePatch = signal<LeadVoiceFormValues | null>(null);
  protected readonly countryOptions = COUNTRY_OPTIONS;
  protected readonly currencyOptions = CURRENCY_OPTIONS;
  protected readonly emailStatuses = EMAIL_STATUSES;
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
      country: new FormControl('', {
        nonNullable: true,
      }),
      emailStatus: new FormControl<EmailStatus>('unknown', { nonNullable: true }),
      phone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
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
        validators: [Validators.pattern(/^[A-Z]{3}$/)],
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
      consentEvidence: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(4000)],
      }),
      consentReference: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(255)],
      }),
    },
    { validators: relatedFieldsValidator },
  );

  constructor() {
    if (
      this.auth.hasPermission(PERMISSIONS.leadsAssign) &&
      this.auth.hasPermission(PERMISSIONS.settingsUsersView)
    ) {
      this.loadAssignees();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['lead']) this.populate(this.lead());
  }

  protected submit(): void {
    if (this.saving()) return;
    if (!this.canSaveLead()) {
      this.message.set(this.savePermissionMessage());
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.message.set('Review the highlighted fields before saving.');
      return;
    }
    const existing = this.lead();
    const fields = this.toDto();
    const operation = existing
      ? this.leads.update(existing.id, { ...fields, row_version: existing.row_version })
      : this.leads.create(fields);
    this.saving.set(true);
    this.message.set('');
    this.duplicate.set(null);
    this.stale.set(false);
    operation
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => this.saved.emit(data),
        error: (error: unknown) => this.handleError(error),
      });
  }

  protected fieldError(controlName: keyof typeof this.form.controls): string {
    const control = this.form.controls[controlName];
    if (!(control.touched || control.dirty) || !control.errors) return '';
    const labels: Partial<Record<keyof typeof this.form.controls, string>> = {
      firstName: 'First name',
      lastName: 'Last name',
      email: 'Email',
      designation: 'Designation',
      company: 'Company',
      phone: 'Phone',
      city: 'City',
      state: 'State',
      industry: 'Industry',
      serviceRequested: 'Service requested',
      revenueAmount: 'Revenue amount',
      revenueCurrency: 'Revenue currency',
      notes: 'Notes',
      consentEvidence: 'Consent evidence',
      consentReference: 'Consent reference',
    };
    const name = labels[controlName] || 'This field';
    if (control.hasError('required')) return `${name} is required.`;
    if (control.hasError('email')) return 'Enter a valid email address.';
    if (control.hasError('url')) return 'Enter a valid domain or HTTP/HTTPS URL.';
    if (control.hasError('maxlength')) return `${name} is too long.`;
    if (control.hasError('min')) return 'Revenue cannot be negative.';
    if (control.hasError('pattern')) {
      if (controlName === 'revenueCurrency') return 'Use a three-letter ISO currency code.';
      if (controlName === 'assignedUserId') return 'Enter a valid user UUID.';
      return 'Use up to 16 digits and no more than 2 decimal places.';
    }
    if (control.hasError('server')) return String(control.getError('server'));
    return 'Check this value.';
  }

  protected canAssign(): boolean {
    return this.auth.hasPermission(PERMISSIONS.leadsAssign);
  }

  protected canChooseAssignee(): boolean {
    return this.canAssign() && this.auth.hasPermission(PERMISSIONS.settingsUsersView);
  }

  protected canUseVoiceFill(): boolean {
    return this.auth.hasPermission(PERMISSIONS.leadsView);
  }

  protected canSaveLead(): boolean {
    return this.auth.hasPermission(this.lead() ? PERMISSIONS.leadsUpdate : PERMISSIONS.leadsCreate);
  }

  protected savePermissionMessage(): string {
    return this.lead()
      ? 'You can review this lead, but your role does not have permission to save lead changes.'
      : 'You can use Fill by Voice and edit this draft, but your role does not have permission to create leads.';
  }

  protected applyVoiceDraft(draft: LeadVoiceFormValues): void {
    this.voiceNotice.set('');
    const conflicts: VoiceOverwriteConflict[] = [];
    for (const [field, rawValue] of Object.entries(draft) as [LeadVoiceFieldName, string][]) {
      const proposed = rawValue.trim();
      if (!proposed) continue;
      const control = this.form.controls[VOICE_FIELD_FORM_MAP[field]] as AbstractControl;
      const current = String(control.value ?? '').trim();
      if (current && current !== proposed) {
        conflicts.push({ field, label: VOICE_FIELD_LABELS[field], current, proposed });
      }
    }
    if (conflicts.length) {
      this.pendingVoicePatch.set(draft);
      this.voiceConflicts.set(conflicts);
      return;
    }
    this.commitVoicePatch(draft);
  }

  protected applyVoiceToBlankFields(): void {
    const pending = this.pendingVoicePatch();
    if (!pending) return;
    const blankOnly: LeadVoiceFormValues = {};
    for (const [field, value] of Object.entries(pending) as [LeadVoiceFieldName, string][]) {
      const control = this.form.controls[VOICE_FIELD_FORM_MAP[field]] as AbstractControl;
      if (!String(control.value ?? '').trim()) blankOnly[field] = value;
    }
    this.commitVoicePatch(blankOnly);
  }

  protected confirmVoiceOverwrite(): void {
    const pending = this.pendingVoicePatch();
    if (pending) this.commitVoicePatch(pending);
  }

  protected cancelVoiceApply(): void {
    this.pendingVoicePatch.set(null);
    this.voiceConflicts.set([]);
    this.voiceNotice.set('Voice draft was not applied. Your existing entries are unchanged.');
  }

  private toDto(): LeadCreateRequest {
    const value = this.form.getRawValue();
    const optional = (input: string): string | null => input.trim() || null;
    const fields: LeadFieldsDto = {
      first_name: value.firstName.trim().replace(/\s+/g, ' '),
      last_name: value.lastName.trim().replace(/\s+/g, ' '),
      email: value.email.trim().toLowerCase(),
      designation: optional(value.designation),
      company: optional(value.company),
      country: optional(countryName(value.country)),
      email_status: value.emailStatus,
      phone: optional(value.phone),
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
      consent_status: value.consentStatus,
      consent_evidence: optional(value.consentEvidence),
      consent_reference: optional(value.consentReference),
    };
    if (this.canAssign()) {
      return { ...fields, assigned_user_id: optional(value.assignedUserId) };
    }
    return fields;
  }

  private commitVoicePatch(patch: LeadVoiceFormValues): void {
    let updated = 0;
    for (const [field, rawValue] of Object.entries(patch) as [LeadVoiceFieldName, string][]) {
      const value = rawValue.trim();
      if (!value) continue;
      const control = this.form.controls[VOICE_FIELD_FORM_MAP[field]] as AbstractControl;
      if (String(control.value ?? '').trim() === value) continue;
      control.setValue(value);
      control.markAsDirty();
      control.updateValueAndValidity({ emitEvent: true });
      updated += 1;
    }
    if (updated) this.form.markAsDirty();
    this.form.updateValueAndValidity({ emitEvent: true });
    this.pendingVoicePatch.set(null);
    this.voiceConflicts.set([]);
    this.voiceNotice.set(
      updated
        ? `${updated} voice field${updated === 1 ? '' : 's'} applied. Review the form, then save when ready.`
        : 'No new voice values were available to apply.',
    );
  }

  private populate(lead: Lead | null): void {
    if (!lead) return;
    this.form.reset({
      firstName: lead.first_name,
      lastName: lead.last_name,
      email: lead.email,
      designation: lead.designation || '',
      company: lead.company || '',
      country: countryName(lead.country),
      emailStatus: lead.email_status,
      phone: lead.phone || '',
      city: lead.city || '',
      state: lead.state || '',
      linkedinUrl: lead.linkedin_url || '',
      facebookUrl: lead.facebook_url || '',
      instagramUrl: lead.instagram_url || '',
      xUrl: lead.x_url || '',
      githubUrl: lead.github_url || '',
      companyWebsite: lead.company_website || '',
      industry: lead.industry || '',
      serviceRequested: lead.service_requested || '',
      companySize: lead.company_size || '',
      revenueAmount: lead.revenue_amount || '',
      revenueCurrency: lead.revenue_currency || '',
      revenuePeriod: lead.revenue_period || '',
      notes: lead.notes || '',
      assignedUserId: lead.assigned_user_id || '',
      consentStatus: lead.consent_status,
      consentEvidence: lead.consent_evidence || '',
      consentReference: lead.consent_reference || '',
    });
  }

  private loadAssignees(): void {
    this.loadingAssignees.set(true);
    this.settings
      .listUsers(1, 100)
      .pipe(
        finalize(() => this.loadingAssignees.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => this.assignees.set(data.items.filter((user) => user.is_active)),
      });
  }

  private handleError(error: unknown): void {
    const details = leadErrorDetails(
      error,
      `Unable to ${this.lead() ? 'update' : 'create'} the lead.`,
    );
    this.message.set(details.message);
    this.duplicate.set(details.duplicate || null);
    this.stale.set(details.stale);
    const controlMap: Record<string, keyof typeof this.form.controls> = {
      first_name: 'firstName',
      last_name: 'lastName',
      email: 'email',
      designation: 'designation',
      company: 'company',
      country: 'country',
      email_status: 'emailStatus',
      phone: 'phone',
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
      consent_status: 'consentStatus',
      consent_evidence: 'consentEvidence',
      consent_reference: 'consentReference',
    };
    for (const [field, message] of Object.entries(details.fieldErrors)) {
      const controlName = controlMap[field];
      if (controlName) {
        this.form.controls[controlName].setErrors({ server: message });
        this.form.controls[controlName].markAsTouched();
      }
    }
  }
}
