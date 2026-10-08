import {
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormRecord,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, finalize } from 'rxjs';

import {
  COMPANY_SIZES,
  CompanySize,
  REVENUE_PERIODS,
  RevenuePeriod,
} from '../../models/lead.models';
import {
  LEAD_VOICE_MAX_DURATION_SECONDS,
  LeadVoiceExtractResponse,
  LeadVoiceFieldError,
  LeadVoiceFieldName,
  LeadVoiceFormValues,
  LeadVoiceRecording,
  LeadVoiceRecordingError,
} from '../../models/lead-voice.models';
import { leadErrorDetails } from '../../services/lead-errors';
import { LeadVoiceRecordingService } from '../../services/lead-voice-recording.service';
import { LeadVoiceService } from '../../services/lead-voice.service';
import { optionalLeadUrlValidator } from '../../validators/lead-url.validator';

type VoiceState = 'idle' | 'starting' | 'recording' | 'processing' | 'review' | 'error';
type ReviewFieldKind = 'text' | 'email' | 'tel' | 'url' | 'decimal' | 'select' | 'textarea';

interface ReviewField {
  name: LeadVoiceFieldName;
  label: string;
  kind: ReviewFieldKind;
  placeholder?: string;
  options?: readonly (CompanySize | RevenuePeriod)[];
}

const REVIEW_FIELDS: readonly ReviewField[] = [
  { name: 'first_name', label: 'First Name', kind: 'text' },
  { name: 'last_name', label: 'Last Name', kind: 'text' },
  { name: 'email', label: 'Email', kind: 'email' },
  { name: 'phone', label: 'Phone', kind: 'tel' },
  { name: 'designation', label: 'Designation', kind: 'text' },
  { name: 'company', label: 'Company', kind: 'text' },
  { name: 'country', label: 'Country', kind: 'text' },
  { name: 'city', label: 'City', kind: 'text' },
  { name: 'state', label: 'State / region', kind: 'text' },
  { name: 'company_website', label: 'Company Website', kind: 'url', placeholder: 'example.com' },
  { name: 'industry', label: 'Industry', kind: 'text' },
  { name: 'company_size', label: 'Company Size', kind: 'select', options: COMPANY_SIZES },
  { name: 'revenue_amount', label: 'Revenue Amount', kind: 'decimal' },
  { name: 'revenue_currency', label: 'Revenue Currency', kind: 'text', placeholder: 'USD' },
  { name: 'revenue_period', label: 'Revenue Period', kind: 'select', options: REVENUE_PERIODS },
  { name: 'linkedin_url', label: 'LinkedIn URL', kind: 'url' },
  { name: 'facebook_url', label: 'Facebook URL', kind: 'url' },
  { name: 'instagram_url', label: 'Instagram URL', kind: 'url' },
  { name: 'x_url', label: 'X URL', kind: 'url' },
  { name: 'github_url', label: 'GitHub URL', kind: 'url' },
  { name: 'service_requested', label: 'Service Requested', kind: 'text' },
  { name: 'notes', label: 'Notes', kind: 'textarea' },
] as const;

const reviewRevenueValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const values = ['revenue_amount', 'revenue_currency', 'revenue_period'].map((field) =>
    String(control.get(field)?.value || '').trim(),
  );
  return values.some(Boolean) && !values.every(Boolean) ? { revenueIncomplete: true } : null;
};

@Component({
  selector: 'app-lead-voice-input',
  imports: [ReactiveFormsModule],
  providers: [LeadVoiceRecordingService],
  templateUrl: './lead-voice-input.component.html',
  styleUrl: './lead-voice-input.component.css',
})
export class LeadVoiceInputComponent implements OnInit, OnDestroy {
  readonly applyDraft = output<LeadVoiceFormValues>();

  private readonly voice = inject(LeadVoiceService);
  private readonly recorder = inject(LeadVoiceRecordingService);
  private readonly destroyRef = inject(DestroyRef);
  private requestSubscription: Subscription | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private recordingStartedAt = 0;
  private operationId = 0;
  private recordedAudio: LeadVoiceRecording | null = null;

  protected readonly state = signal<VoiceState>('idle');
  protected readonly supported = signal(true);
  protected readonly elapsedSeconds = signal(0);
  protected readonly errorMessage = signal('');
  protected readonly transcript = signal('');
  protected readonly fieldErrors = signal<LeadVoiceFieldError[]>([]);
  protected readonly reviewWarnings = signal<string[]>([]);
  protected readonly reviewFields = REVIEW_FIELDS;
  protected readonly maxDuration = LEAD_VOICE_MAX_DURATION_SECONDS;
  protected readonly formattedTime = computed(
    () => `${this.formatSeconds(this.elapsedSeconds())} / ${this.formatSeconds(this.maxDuration)}`,
  );
  protected readonly reviewForm = new FormRecord<FormControl<string>>(
    {},
    { validators: reviewRevenueValidator },
  );

  constructor() {
    for (const field of REVIEW_FIELDS) {
      this.reviewForm.addControl(
        field.name,
        new FormControl('', {
          nonNullable: true,
          validators: this.validatorsFor(field.name),
        }),
      );
    }
  }

  ngOnInit(): void {
    this.supported.set(this.recorder.isSupported());
  }

  ngOnDestroy(): void {
    this.operationId += 1;
    this.stopTimer();
    this.requestSubscription?.unsubscribe();
    this.recorder.cancel();
  }

  protected async startRecording(): Promise<void> {
    const operationId = ++this.operationId;
    this.requestSubscription?.unsubscribe();
    this.recordedAudio = null;
    this.clearResult();
    this.errorMessage.set('');
    this.state.set('starting');
    try {
      await this.recorder.start();
      if (operationId !== this.operationId) {
        this.recorder.cancel();
        return;
      }
      this.recordingStartedAt = Date.now();
      this.elapsedSeconds.set(0);
      this.state.set('recording');
      this.timerId = setInterval(() => this.updateTimer(), 250);
    } catch (error: unknown) {
      if (operationId !== this.operationId) return;
      this.state.set('error');
      this.errorMessage.set(
        error instanceof LeadVoiceRecordingError
          ? error.message
          : 'The recording could not be started. Please try again.',
      );
    }
  }

  protected async stopRecording(): Promise<void> {
    if (this.state() !== 'recording') return;
    const operationId = this.operationId;
    this.stopTimer();
    this.state.set('processing');
    try {
      const recording = await this.recorder.stop();
      if (operationId !== this.operationId || this.state() !== 'processing') return;
      this.recordedAudio = recording;
      this.extract(recording);
    } catch (error: unknown) {
      if (operationId !== this.operationId) return;
      this.state.set('error');
      this.errorMessage.set(
        error instanceof LeadVoiceRecordingError
          ? error.message
          : 'The recording could not be completed. Please try again.',
      );
    }
  }

  protected cancel(): void {
    this.operationId += 1;
    this.stopTimer();
    this.requestSubscription?.unsubscribe();
    this.requestSubscription = null;
    this.recorder.cancel();
    if (this.state() === 'processing' && this.recordedAudio) {
      this.state.set('error');
      this.errorMessage.set('Processing was cancelled. Retry only when you are ready.');
      return;
    }
    this.recordedAudio = null;
    this.clearResult();
    this.errorMessage.set('');
    this.state.set('idle');
  }

  protected retryExtraction(): void {
    if (!this.recordedAudio || this.state() === 'processing') return;
    this.errorMessage.set('');
    this.state.set('processing');
    this.extract(this.recordedAudio);
  }

  protected canRetryExtraction(): boolean {
    return Boolean(this.recordedAudio);
  }

  protected reset(): void {
    this.cancel();
  }

  protected requestApply(): void {
    if (this.reviewForm.invalid) {
      this.reviewForm.markAllAsTouched();
      return;
    }
    const draft: LeadVoiceFormValues = {};
    for (const field of REVIEW_FIELDS) {
      const value = this.reviewForm.controls[field.name].value.trim();
      if (value) draft[field.name] = value;
    }
    this.applyDraft.emit(draft);
  }

  protected fieldError(field: LeadVoiceFieldName): string {
    const control = this.reviewForm.controls[field];
    const backendError = this.fieldErrors().find((error) => error.field === field)?.message;
    if (backendError && !control.dirty) return backendError;
    if (!(control.dirty || control.touched) || !control.errors) return '';
    if (control.hasError('email')) return 'Enter a valid email address.';
    if (control.hasError('url')) return 'Enter a valid domain or HTTP/HTTPS URL.';
    if (control.hasError('maxlength')) return 'This value is too long.';
    if (control.hasError('pattern')) {
      return field === 'revenue_currency'
        ? 'Use a three-letter ISO currency code.'
        : 'Use up to 16 digits and no more than 2 decimal places.';
    }
    return 'Check this value.';
  }

  protected labelValue(value: string): string {
    return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  protected errorFieldLabel(field: string): string {
    return (
      REVIEW_FIELDS.find((candidate) => candidate.name === field)?.label || this.labelValue(field)
    );
  }

  private extract(recording: LeadVoiceRecording): void {
    this.requestSubscription?.unsubscribe();
    this.requestSubscription = this.voice
      .extract(recording)
      .pipe(
        finalize(() => (this.requestSubscription = null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response) => this.loadReview(response),
        error: (error: unknown) => {
          this.state.set('error');
          this.errorMessage.set(
            leadErrorDetails(error, 'Unable to extract lead details from this recording.').message,
          );
        },
      });
  }

  private loadReview(response: LeadVoiceExtractResponse): void {
    const values: Record<string, string> = {};
    for (const field of REVIEW_FIELDS) {
      const value = response.extracted_fields[field.name];
      values[field.name] = value === null || value === undefined ? '' : String(value);
    }
    this.reviewForm.reset(values);
    this.reviewForm.markAsPristine();
    this.transcript.set(response.transcript);
    this.fieldErrors.set(response.field_errors);
    this.reviewWarnings.set(response.review_warnings);
    this.errorMessage.set('');
    this.state.set('review');
  }

  private clearResult(): void {
    this.transcript.set('');
    this.fieldErrors.set([]);
    this.reviewWarnings.set([]);
    this.reviewForm.reset();
  }

  private updateTimer(): void {
    if (this.state() !== 'recording') return;
    const elapsedMilliseconds = Date.now() - this.recordingStartedAt;
    this.elapsedSeconds.set(Math.min(this.maxDuration, Math.floor(elapsedMilliseconds / 1_000)));
    if (elapsedMilliseconds >= this.maxDuration * 1_000) void this.stopRecording();
  }

  private stopTimer(): void {
    if (this.timerId !== null) clearInterval(this.timerId);
    this.timerId = null;
  }

  private formatSeconds(value: number): string {
    const minutes = Math.floor(value / 60);
    const seconds = String(value % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  private validatorsFor(field: LeadVoiceFieldName): ValidatorFn[] {
    const maxLengths: Partial<Record<LeadVoiceFieldName, number>> = {
      first_name: 120,
      last_name: 120,
      designation: 160,
      company: 200,
      phone: 80,
      city: 120,
      state: 120,
      industry: 160,
      service_requested: 200,
      notes: 10_000,
      company_website: 2_048,
      linkedin_url: 2_048,
      facebook_url: 2_048,
      instagram_url: 2_048,
      x_url: 2_048,
      github_url: 2_048,
    };
    const validators: ValidatorFn[] = [];
    const maxLength = maxLengths[field];
    if (maxLength) validators.push(Validators.maxLength(maxLength));
    if (field === 'email') validators.push(Validators.email);
    if (field.endsWith('_url') || field === 'company_website') {
      validators.push(optionalLeadUrlValidator);
    }
    if (field === 'revenue_amount') {
      validators.push(Validators.pattern(/^\d{1,16}(\.\d{1,2})?$/));
    }
    if (field === 'revenue_currency') validators.push(Validators.pattern(/^[A-Za-z]{3}$/));
    return validators;
  }
}
