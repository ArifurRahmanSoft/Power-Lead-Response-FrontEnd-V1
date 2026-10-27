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
  LeadUpdateFields,
  PendingTaskDisposition,
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
  protected readonly assigneeOptionsLoaded = signal(false);
  protected readonly assigneeLoadError = signal('');
  protected readonly originalAssigneeId = signal<string | null>(null);
  protected readonly serverFieldErrors = signal<Record<string, string>>({});
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
      assignmentReason: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(1000)],
      }),
      pendingTaskDisposition: new FormControl<PendingTaskDisposition>('transfer', {
        nonNullable: true,
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
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.serverFieldErrors.set({}));
    this.form.controls.assignedUserId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncAssignmentValidators());
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
    this.serverFieldErrors.set({});
    if (!this.canSaveLead()) {
      this.message.set(this.savePermissionMessage());
      return;
    }
    this.syncAssignmentValidators();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.message.set('Review the highlighted fields before saving.');
      return;
    }
    const existing = this.lead();
    const fields = this.toDto(!existing);
    let operation;
    if (existing) {
      const changes: LeadUpdateFields = { ...fields };
      if (this.canAssign() && this.assignmentChanged()) {
        const value = this.form.getRawValue();
        changes.assigned_user_id = this.selectedAssigneeId();
        changes.assignment_reason = value.assignmentReason.trim();
        changes.pending_task_disposition = value.pendingTaskDisposition;
      }
      operation = this.leads.update(existing.id, {
        ...changes,
        row_version: existing.row_version,
      });
    } else {
      operation = this.leads.create(fields);
    }
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
    const serverFieldError = this.serverFieldErrors()[controlName];
    if (serverFieldError) return serverFieldError;
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
      assignmentReason: 'Assignment reason',
      pendingTaskDisposition: 'Pending task choice',
    };
    const name = labels[controlName] || 'This field';
    if (control.hasError('server')) return String(control.getError('server'));
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
    return 'Check this value.';
  }

  protected canAssign(): boolean {
    return this.auth.hasPermission(PERMISSIONS.leadsAssign);
  }

  protected canChooseAssignee(): boolean {
    return this.canAssign() && this.auth.hasPermission(PERMISSIONS.settingsUsersView);
  }

  protected assignmentChanged(): boolean {
    return Boolean(this.lead()) && this.selectedAssigneeId() !== this.originalAssigneeId();
  }

  protected originalAssigneeResolved(): boolean {
    const original = this.originalAssigneeId();
    return !original || this.assignees().some((user) => user.id === original);
  }

  protected assigneeResolutionMessage(): string {
    const original = this.originalAssigneeId();
    if (!original || this.originalAssigneeResolved()) return '';
    if (this.loadingAssignees()) {
      return 'Loading eligible users. The saved assignee will remain selected while the list loads.';
    }
    if (this.assigneeLoadError()) return this.assigneeLoadError();
    if (this.assigneeOptionsLoaded()) {
      return 'The saved assignee is not in the eligible-user list. It will be preserved unless you explicitly choose another assignee or Unassigned.';
    }
    return '';
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

  private toDto(includeAssignment = !this.lead()): LeadCreateRequest {
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
    if (includeAssignment && this.canAssign()) {
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
    this.originalAssigneeId.set(lead.assigned_user_id);
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
      assignmentReason: '',
      pendingTaskDisposition: 'transfer',
      consentStatus: lead.consent_status,
      consentEvidence: lead.consent_evidence || '',
      consentReference: lead.consent_reference || '',
    });
    this.syncAssignmentValidators();
  }

  private loadAssignees(page = 1, accumulated: SettingsUser[] = []): void {
    if (page === 1) {
      this.loadingAssignees.set(true);
      this.assigneeOptionsLoaded.set(false);
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
            return;
          }
          this.assigneeOptionsLoaded.set(true);
          this.loadingAssignees.set(false);
        },
        error: () => {
          this.assigneeLoadError.set(
            'Eligible users could not be loaded. The saved assignee is preserved; reload before changing it.',
          );
          this.assigneeOptionsLoaded.set(true);
          this.loadingAssignees.set(false);
        },
      });
  }

  private selectedAssigneeId(): string | null {
    return this.form.controls.assignedUserId.value.trim() || null;
  }

  private syncAssignmentValidators(): void {
    const reason = this.form.controls.assignmentReason;
    const disposition = this.form.controls.pendingTaskDisposition;
    reason.setValidators(
      this.assignmentChanged()
        ? [Validators.required, Validators.maxLength(1000)]
        : [Validators.maxLength(1000)],
    );
    disposition.setValidators(this.assignmentChanged() ? [Validators.required] : []);
    reason.updateValueAndValidity({ emitEvent: false });
    disposition.updateValueAndValidity({ emitEvent: false });
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
      assignment_reason: 'assignmentReason',
      pending_task_disposition: 'pendingTaskDisposition',
      consent_status: 'consentStatus',
      consent_evidence: 'consentEvidence',
      consent_reference: 'consentReference',
    };
    const serverFieldErrors: Record<string, string> = {};
    for (const [field, message] of Object.entries(details.fieldErrors)) {
      const controlName = controlMap[field];
      if (controlName) {
        serverFieldErrors[controlName] = message;
        this.form.controls[controlName].setErrors({
          ...this.form.controls[controlName].errors,
          server: message,
        });
        this.form.controls[controlName].markAsTouched();
      }
    }
    if (!Object.keys(details.fieldErrors).length) {
      const inferredControl = /assignment_reason/i.test(details.message)
        ? this.form.controls.assignmentReason
        : /pending_task_disposition/i.test(details.message)
          ? this.form.controls.pendingTaskDisposition
          : /assignee|assigned_user_id/i.test(details.message)
            ? this.form.controls.assignedUserId
            : null;
      if (inferredControl) {
        inferredControl.setErrors({ ...inferredControl.errors, server: details.message });
        inferredControl.markAsTouched();
        const inferredEntry = Object.entries(this.form.controls).find(
          ([, control]) => control === inferredControl,
        );
        if (inferredEntry) serverFieldErrors[inferredEntry[0]] = details.message;
      }
    }
    this.serverFieldErrors.set(serverFieldErrors);
  }
}
