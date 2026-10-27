import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, Observable, catchError, expand, finalize, forkJoin, map, of, reduce } from 'rxjs';

import { PERMISSIONS } from '../../../../core/models/auth.models';
import { SettingsUser } from '../../../../core/models/settings.models';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { catalogLabel, countryName } from '../../models/lead-catalogs';
import {
  LEAD_ACTIVITY_CHANNELS,
  LEAD_ACTIVITY_TYPES,
  LEAD_PRIORITIES,
  LEAD_STATUS_TRANSITIONS,
  Lead,
  LeadActivity,
  LeadActivityChannel,
  LeadActivityDirection,
  LeadActivityType,
  LeadAssignmentHistory,
  LeadBooking,
  LeadBookingEvent,
  LeadPriority,
  LeadStatus,
  PendingTaskDisposition,
} from '../../models/lead.models';
import { leadErrorDetails } from '../../services/lead-errors';
import { LeadsService } from '../../services/leads.service';
import { normalizeLeadUrl } from '../../validators/lead-url.validator';
import { TaskManagerComponent } from '../../../tasks/components/task-manager/task-manager.component';
import {
  Customer,
  CustomerDuplicateResolution,
  LeadConversion,
  LeadConversionResult,
} from '../../../customers/models/customer.models';
import { CustomersService } from '../../../customers/services/customers.service';
import { SendEmailComponent } from '../../../mail/send-email/send-email.component';
import {
  OutboundMessage,
  OutboundMessageStatus,
} from '../../../mail/models/outbound-message.models';
import { OutboundMessagesService } from '../../../mail/services/outbound-messages.service';
import { emailConsentDenialIssue } from '../../../mail/email-consent';

const ACTIVITY_PAGE_SIZE = 10;
const API_PAGE_SIZE = 100;
const ACTIVITY_DIRECTION: Readonly<Record<LeadActivityType, LeadActivityDirection>> = {
  initial_contact: 'outbound',
  follow_up: 'outbound',
  inbound_reply: 'inbound',
  note: 'internal',
};

type TimelineEntry =
  | { kind: 'activity'; id: string; timestamp: string; activity: LeadActivity }
  | { kind: 'assignment'; id: string; timestamp: string; assignment: LeadAssignmentHistory }
  | {
      kind: 'booking';
      id: string;
      timestamp: string;
      booking: LeadBooking;
      event: LeadBookingEvent;
      current: boolean;
    };

interface BookingTimelineRecord {
  booking: LeadBooking;
  event: LeadBookingEvent;
}

function localDateTimeValue(value: string | Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

@Component({
  selector: 'app-lead-detail',
  imports: [DatePipe, ReactiveFormsModule, RouterLink, TaskManagerComponent, SendEmailComponent],
  templateUrl: './lead-detail.component.html',
})
export class LeadDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly leads = inject(LeadsService);
  private readonly settings = inject(SettingsService);
  private readonly customers = inject(CustomersService);
  private readonly outboundMessagesService = inject(OutboundMessagesService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);

  protected readonly permissions = PERMISSIONS;
  protected readonly lead = signal<Lead | null>(null);
  protected readonly outboundMessages = signal<Readonly<Record<string, OutboundMessage>>>({});
  protected readonly emailEligibilityIssues = computed(() => {
    const current = this.lead();
    if (!current) return [];
    const issues: string[] = [];
    if (current.status === 'converted')
      issues.push(
        'Converted leads cannot receive acquisition email. Use the customer record instead.',
      );
    const consentIssue = emailConsentDenialIssue('Lead', current.consent_status);
    if (consentIssue) issues.push(consentIssue);
    if (['invalid', 'bounced', 'disposable'].includes(current.email_status)) {
      issues.push(`The lead email status is ${this.label(current.email_status)}.`);
    }
    return issues;
  });
  protected readonly loading = signal(true);
  protected readonly savingStatus = signal(false);
  protected readonly savingPriority = signal(false);
  protected readonly archiving = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly notice = signal(
    this.route.snapshot.queryParamMap.get('saved') ? 'Lead saved successfully.' : '',
  );
  protected readonly permissionDenied = signal(false);
  protected readonly archiveOpen = signal(false);
  protected readonly detailTab = signal<'details' | 'tasks'>('details');
  protected readonly followUpRequest = signal(0);
  protected readonly taskRefreshRequest = signal(0);
  protected readonly statusControl = new FormControl<LeadStatus | ''>('', { nonNullable: true });
  protected readonly priorityControl = new FormControl<LeadPriority>('normal', {
    nonNullable: true,
    validators: [Validators.required],
  });
  protected readonly priorities = LEAD_PRIORITIES;
  protected readonly label = catalogLabel;
  protected readonly nextStatuses = computed(() => {
    const current = this.lead();
    return current
      ? LEAD_STATUS_TRANSITIONS[current.status].filter((status) => status !== 'converted')
      : [];
  });
  protected readonly canConvert = computed(
    () =>
      this.lead()?.status === 'engaged' && this.auth.hasPermission(PERMISSIONS.customersConvert),
  );
  protected readonly customerLifecycle = signal<{
    customer: Customer;
    conversion: LeadConversion;
  } | null>(null);
  protected readonly customerLifecycleLoading = signal(false);
  protected readonly conversionResult = signal<LeadConversionResult | null>(null);
  protected readonly conversionModalOpen = signal(false);
  protected readonly conversionSaving = signal(false);
  protected readonly conversionError = signal('');
  protected readonly conversionFieldErrors = signal<Record<string, string>>({});
  protected readonly customerOptions = signal<Customer[]>([]);
  protected readonly customerOptionsLoading = signal(false);
  protected readonly conversionForm = new FormGroup({
    purchasedService: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    reference: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(255)],
    }),
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(1000)],
    }),
    duplicateResolution: new FormControl<CustomerDuplicateResolution>('create_new', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    existingCustomerId: new FormControl('', { nonNullable: true }),
    pendingTaskDisposition: new FormControl<'cancel' | 'retain'>('cancel', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    pendingTaskReason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(1000)],
    }),
    confirmed: new FormControl(false, {
      nonNullable: true,
      validators: [Validators.requiredTrue],
    }),
  });

  protected readonly activityTypes = LEAD_ACTIVITY_TYPES;
  protected readonly activityChannels = LEAD_ACTIVITY_CHANNELS;
  protected readonly activities = signal<LeadActivity[]>([]);
  protected readonly assignmentHistory = signal<LeadAssignmentHistory[]>([]);
  protected readonly assignmentHistoryLoading = signal(false);
  protected readonly assignmentHistoryError = signal('');
  protected readonly activityLoading = signal(false);
  protected readonly activitySaving = signal(false);
  protected readonly activityError = signal('');
  protected readonly activityFieldErrors = signal<Record<string, string>>({});
  protected readonly activityPage = signal(1);
  protected readonly activityTotal = computed(
    () => this.activities().length + this.bookingEvents().length + this.assignmentHistory().length,
  );
  protected readonly activityPageCount = computed(() =>
    Math.max(1, Math.ceil(this.activityTotal() / ACTIVITY_PAGE_SIZE)),
  );
  protected readonly activityModalOpen = signal(false);
  protected readonly correctingActivity = signal<LeadActivity | null>(null);
  protected readonly performerUsers = signal<SettingsUser[]>([]);
  protected readonly performerUsersLoading = signal(false);
  protected readonly canChoosePerformer = computed(() =>
    this.auth.hasPermission(PERMISSIONS.settingsUsersView),
  );
  protected readonly timezoneLabel =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  protected readonly bookings = signal<LeadBooking[]>([]);
  protected readonly bookingEvents = signal<BookingTimelineRecord[]>([]);
  protected readonly bookingLoading = signal(false);
  protected readonly bookingError = signal('');
  protected readonly bookingSaving = signal(false);
  protected readonly bookingFieldErrors = signal<Record<string, string>>({});
  protected readonly bookingModalOpen = signal(false);
  protected readonly reschedulingBooking = signal<LeadBooking | null>(null);
  protected readonly cancellingBooking = signal<LeadBooking | null>(null);
  protected readonly replyModalOpen = signal(false);
  protected readonly replySaving = signal(false);
  protected readonly replyOptionsLoading = signal(false);
  protected readonly replyFieldErrors = signal<Record<string, string>>({});
  protected readonly replyActivities = signal<LeadActivity[]>([]);
  protected readonly canAssignBooking = computed(() =>
    this.auth.hasPermission(PERMISSIONS.leadsAssign),
  );
  protected readonly canForwardLead = computed(
    () =>
      this.auth.hasPermission(PERMISSIONS.leadsUpdate) &&
      this.auth.hasPermission(PERMISSIONS.leadsAssign) &&
      this.auth.hasPermission(PERMISSIONS.settingsUsersView),
  );
  protected readonly assignmentModalOpen = signal(false);
  protected readonly assignmentSaving = signal(false);
  protected readonly assignmentError = signal('');
  protected readonly assignmentFieldErrors = signal<Record<string, string>>({});
  protected readonly assignmentForm = new FormGroup({
    newAssigneeId: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(1000)],
    }),
    taskDisposition: new FormControl<PendingTaskDisposition>('transfer', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });
  private readonly allTimelineEntries = computed<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = this.activities().map((activity) => ({
      kind: 'activity',
      id: `activity-${activity.id}`,
      timestamp: activity.recorded_at,
      activity,
    }));
    const bookingEvents = this.bookingEvents();
    entries.push(
      ...bookingEvents.map(({ booking, event }): TimelineEntry => ({
        kind: 'booking',
        id: `booking-${booking.id}-${event.id}`,
        timestamp: event.recorded_at,
        booking,
        event,
        current:
          event.id ===
          bookingEvents
            .filter((candidate) => candidate.booking.id === booking.id)
            .sort((left, right) => this.compareBookingEvents(left.event, right.event))[0]?.event.id,
      })),
    );
    entries.push(
      ...this.assignmentHistory().map((assignment): TimelineEntry => ({
        kind: 'assignment',
        id: `assignment-${assignment.id}`,
        timestamp: assignment.assigned_at,
        assignment,
      })),
    );
    return entries.sort(
      (left, right) =>
        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime() ||
        right.id.localeCompare(left.id),
    );
  });
  protected readonly timelineEntries = computed<TimelineEntry[]>(() => {
    const start = (this.activityPage() - 1) * ACTIVITY_PAGE_SIZE;
    return this.allTimelineEntries().slice(start, start + ACTIVITY_PAGE_SIZE);
  });

  protected readonly activityForm = new FormGroup({
    activityType: new FormControl<LeadActivityType>('initial_contact', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    channel: new FormControl<(typeof LEAD_ACTIVITY_CHANNELS)[number]>('email', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    direction: new FormControl<LeadActivityDirection>(
      { value: 'outbound', disabled: true },
      {
        nonNullable: true,
        validators: [Validators.required],
      },
    ),
    occurredAt: new FormControl(localDateTimeValue(), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    performedBy: new FormControl('', { nonNullable: true }),
    outcome: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(10_000)] }),
    amendmentReason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(1000)],
    }),
  });

  protected readonly replyForm = new FormGroup({
    channel: new FormControl<LeadActivityChannel>('email', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    occurredAt: new FormControl(localDateTimeValue(), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    relatedActivityId: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    summary: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(10_000)],
    }),
  });

  protected readonly bookingForm = new FormGroup({
    scheduledAt: new FormControl(localDateTimeValue(), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    timezone: new FormControl(this.timezoneLabel, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    responsibleUserId: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    status: new FormControl<'scheduled' | 'confirmed'>('scheduled', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(10_000)] }),
  });

  protected readonly cancellationNotes = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(10_000)],
  });

  private readonly leadId = this.route.snapshot.paramMap.get('id') || '';

  constructor() {
    this.activityForm.controls.activityType.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((type) => {
        this.activityForm.controls.direction.setValue(ACTIVITY_DIRECTION[type]);
        if (type === 'note') {
          this.activityForm.controls.channel.setValue('other');
          this.activityForm.controls.channel.disable();
        } else {
          this.activityForm.controls.channel.enable();
        }
      });
    this.resetActivityForm();
    if (this.canChoosePerformer()) this.loadPerformerUsers();
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.permissionDenied.set(false);
    this.leads
      .get(this.leadId)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.lead.set(data);
          this.statusControl.setValue('');
          this.priorityControl.setValue(data.priority);
          this.reloadActivities(1);
          this.loadBookings();
          this.loadAssignmentHistory();
          if (data.status === 'converted') this.loadCustomerLifecycle(data);
          else this.customerLifecycle.set(null);
        },
        error: (error: unknown) => {
          const details = leadErrorDetails(error, 'Unable to load this lead.');
          this.permissionDenied.set(details.forbidden);
          this.errorMessage.set(details.message);
        },
      });
  }

  protected loadActivities(page = this.activityPage()): void {
    if (page < 1 || page > this.activityPageCount()) return;
    this.activityPage.set(page);
  }

  protected reloadActivities(page = this.activityPage()): void {
    this.activityLoading.set(true);
    this.activityError.set('');
    this.loadActivityPages(1, [], page);
  }

  private loadActivityPages(page: number, accumulated: LeadActivity[], targetPage: number): void {
    this.leads
      .listActivities(this.leadId, page, API_PAGE_SIZE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          const activities = this.uniqueById([...accumulated, ...data.items]);
          if (data.page * data.size < data.total) {
            this.loadActivityPages(data.page + 1, activities, targetPage);
          } else {
            this.activities.set(activities);
            this.loadOutboundMessageDetails(activities);
            this.activityPage.set(Math.min(targetPage, this.activityPageCount()));
            this.activityLoading.set(false);
          }
        },
        error: (error: unknown) => {
          this.activityLoading.set(false);
          this.activityError.set(
            leadErrorDetails(error, 'Unable to load the activity timeline.').message,
          );
        },
      });
  }

  protected openLogContact(): void {
    this.correctingActivity.set(null);
    this.resetActivityForm();
    this.clearActivityMessages();
    this.activityModalOpen.set(true);
  }

  protected openConversion(): void {
    const current = this.lead();
    if (!current || !this.canConvert()) return;
    this.conversionForm.reset({
      purchasedService: current.service_requested || '',
      reference: '',
      reason: '',
      duplicateResolution: 'create_new',
      existingCustomerId: '',
      pendingTaskDisposition: 'cancel',
      pendingTaskReason: 'Lead acquisition is complete after conversion',
      confirmed: false,
    });
    this.conversionError.set('');
    this.conversionFieldErrors.set({});
    this.conversionModalOpen.set(true);
    if (this.auth.hasPermission(PERMISSIONS.customersView)) this.loadCustomerOptions();
  }

  protected closeConversion(): void {
    if (this.conversionSaving()) return;
    this.conversionModalOpen.set(false);
    this.conversionError.set('');
    this.conversionFieldErrors.set({});
  }

  protected saveConversion(): void {
    const current = this.lead();
    if (!current || this.conversionSaving()) return;
    const value = this.conversionForm.getRawValue();
    if (value.duplicateResolution === 'link_existing' && !value.existingCustomerId) {
      this.conversionFieldErrors.set({
        existing_customer_id: 'Select the existing customer to link.',
      });
      this.conversionForm.controls.existingCustomerId.markAsTouched();
      return;
    }
    if (this.conversionForm.invalid) {
      this.conversionForm.markAllAsTouched();
      return;
    }

    this.conversionSaving.set(true);
    this.conversionError.set('');
    this.conversionFieldErrors.set({});
    this.customers
      .convert(current.id, {
        row_version: current.row_version,
        purchased_service: value.purchasedService.trim(),
        reference: value.reference.trim() || null,
        reason: value.reason.trim(),
        duplicate_resolution: value.duplicateResolution,
        ...(value.duplicateResolution === 'link_existing'
          ? { existing_customer_id: value.existingCustomerId }
          : {}),
        pending_acquisition_task_disposition: value.pendingTaskDisposition,
        pending_task_reason: value.pendingTaskReason.trim(),
      })
      .pipe(
        finalize(() => this.conversionSaving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data, message }) => {
          this.conversionModalOpen.set(false);
          this.conversionResult.set(data);
          this.customerLifecycle.set({ customer: data.customer, conversion: data.conversion });
          this.notice.set(`${message}. No automatic message was sent.`);
          this.taskRefreshRequest.update((request) => request + 1);
          this.refreshLeadAfterConversion();
        },
        error: (error: unknown) => this.handleConversionError(error),
      });
  }

  protected conversionFieldError(field: string): string {
    const backend = this.conversionFieldErrors()[field];
    if (backend) return backend;
    const control = {
      purchased_service: this.conversionForm.controls.purchasedService,
      reference: this.conversionForm.controls.reference,
      reason: this.conversionForm.controls.reason,
      existing_customer_id: this.conversionForm.controls.existingCustomerId,
      pending_task_reason: this.conversionForm.controls.pendingTaskReason,
      confirmed: this.conversionForm.controls.confirmed,
    }[field];
    if (!control || !(control.touched || control.dirty)) return '';
    if (control.hasError('required') || control.hasError('requiredTrue')) {
      return field === 'confirmed'
        ? 'Confirm the conversion before continuing.'
        : 'This field is required.';
    }
    if (control.hasError('maxlength')) return 'This value is too long.';
    return '';
  }

  protected openAssignment(): void {
    const current = this.lead();
    if (!current || !this.canForwardLead()) return;
    const nextAssignee = this.performerUsers().find((user) => user.id !== current.assigned_user_id);
    this.assignmentForm.reset({
      newAssigneeId: nextAssignee?.id || '',
      reason: '',
      taskDisposition: 'transfer',
    });
    this.assignmentError.set('');
    this.assignmentFieldErrors.set({});
    this.assignmentModalOpen.set(true);
  }

  protected closeAssignment(): void {
    if (this.assignmentSaving()) return;
    this.assignmentModalOpen.set(false);
    this.assignmentError.set('');
    this.assignmentFieldErrors.set({});
  }

  protected saveAssignment(): void {
    const current = this.lead();
    if (!current || this.assignmentSaving()) return;
    if (this.assignmentForm.invalid) {
      this.assignmentForm.markAllAsTouched();
      return;
    }
    const value = this.assignmentForm.getRawValue();
    if (value.newAssigneeId === current.assigned_user_id) {
      this.assignmentFieldErrors.set({ assigned_user_id: 'Choose a different assignee.' });
      return;
    }

    this.assignmentSaving.set(true);
    this.assignmentError.set('');
    this.assignmentFieldErrors.set({});
    this.leads
      .update(current.id, {
        row_version: current.row_version,
        assigned_user_id: value.newAssigneeId,
        assignment_reason: value.reason.trim(),
        pending_task_disposition: value.taskDisposition,
      })
      .pipe(
        finalize(() => this.assignmentSaving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data, message }) => {
          this.lead.set(data);
          this.priorityControl.setValue(data.priority);
          this.assignmentModalOpen.set(false);
          this.notice.set(message || 'Lead responsibility transferred.');
          this.loadAssignmentHistory();
          this.taskRefreshRequest.update((request) => request + 1);
        },
        error: (error: unknown) => {
          const details = leadErrorDetails(error, 'Unable to transfer lead responsibility.');
          this.assignmentError.set(details.message);
          this.assignmentFieldErrors.set(details.fieldErrors);
          if (details.stale) this.refreshAfterConflict('assignment');
        },
      });
  }

  protected openRecordReply(): void {
    if (!this.auth.hasPermission(PERMISSIONS.leadsUpdate)) return;
    this.replyForm.reset({
      channel: 'email',
      occurredAt: localDateTimeValue(),
      relatedActivityId: '',
      summary: '',
    });
    this.replyFieldErrors.set({});
    this.activityError.set('');
    this.replyModalOpen.set(true);
    this.loadReplyActivities();
  }

  protected closeReplyModal(): void {
    if (this.replySaving()) return;
    this.replyModalOpen.set(false);
    this.replyFieldErrors.set({});
  }

  protected saveReply(): void {
    if (this.replyForm.invalid || this.replySaving()) {
      this.replyForm.markAllAsTouched();
      return;
    }
    const value = this.replyForm.getRawValue();
    const occurredAt = new Date(value.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      this.replyFieldErrors.set({ occurred_at: 'Enter a valid date and time.' });
      return;
    }
    this.replySaving.set(true);
    this.replyFieldErrors.set({});
    this.leads
      .recordReply(this.leadId, {
        channel: value.channel,
        occurred_at: occurredAt.toISOString(),
        summary: value.summary.trim(),
        related_outbound_activity_id: value.relatedActivityId,
      })
      .pipe(
        finalize(() => this.replySaving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ message }) => {
          this.replyModalOpen.set(false);
          this.notice.set(message || 'Manual reply recorded.');
          this.reloadActivities(1);
        },
        error: (error: unknown) => {
          const details = leadErrorDetails(error, 'Unable to record this reply.');
          this.activityError.set(details.message);
          this.replyFieldErrors.set(details.fieldErrors);
        },
      });
  }

  protected openRecordBooking(): void {
    if (!this.auth.hasPermission(PERMISSIONS.leadsUpdate)) return;
    this.reschedulingBooking.set(null);
    this.bookingForm.reset({
      scheduledAt: localDateTimeValue(),
      timezone: this.timezoneLabel,
      responsibleUserId: this.auth.user()?.id || '',
      status: 'scheduled',
      notes: '',
    });
    this.bookingFieldErrors.set({});
    this.bookingError.set('');
    this.bookingModalOpen.set(true);
  }

  protected openReschedule(booking: LeadBooking): void {
    if (!this.canModifyBooking(booking)) return;
    this.reschedulingBooking.set(booking);
    this.bookingForm.reset({
      scheduledAt: localDateTimeValue(booking.scheduled_at),
      timezone: this.timezoneLabel,
      responsibleUserId: booking.responsible_user_id,
      status: booking.status === 'confirmed' ? 'confirmed' : 'scheduled',
      notes: '',
    });
    this.bookingFieldErrors.set({});
    this.bookingError.set('');
    this.bookingModalOpen.set(true);
  }

  protected closeBookingModal(): void {
    if (this.bookingSaving()) return;
    this.bookingModalOpen.set(false);
    this.reschedulingBooking.set(null);
    this.bookingFieldErrors.set({});
  }

  protected saveBooking(): void {
    if (this.bookingForm.invalid || this.bookingSaving()) {
      this.bookingForm.markAllAsTouched();
      return;
    }
    const value = this.bookingForm.getRawValue();
    const scheduledAt = new Date(value.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      this.bookingFieldErrors.set({ scheduled_at: 'Enter a valid date and time.' });
      return;
    }
    const rescheduling = this.reschedulingBooking();
    const request = rescheduling
      ? this.leads.rescheduleBooking(this.leadId, rescheduling.id, {
          row_version: rescheduling.row_version,
          scheduled_at: scheduledAt.toISOString(),
          timezone: value.timezone,
          notes: value.notes.trim() || null,
        })
      : this.leads.createBooking(this.leadId, {
          scheduled_at: scheduledAt.toISOString(),
          timezone: value.timezone,
          responsible_user_id: value.responsibleUserId,
          source: 'manual',
          status: value.status,
          notes: value.notes.trim() || null,
        });
    this.bookingSaving.set(true);
    this.bookingFieldErrors.set({});
    request
      .pipe(
        finalize(() => this.bookingSaving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ message }) => {
          this.bookingModalOpen.set(false);
          this.reschedulingBooking.set(null);
          this.notice.set(message || (rescheduling ? 'Booking rescheduled.' : 'Booking recorded.'));
          this.loadBookings();
        },
        error: (error: unknown) => {
          const details = leadErrorDetails(error, 'Unable to save this booking.');
          this.bookingError.set(details.message);
          this.bookingFieldErrors.set(details.fieldErrors);
        },
      });
  }

  protected openCancelBooking(booking: LeadBooking): void {
    if (!this.canModifyBooking(booking)) return;
    this.cancellationNotes.reset('');
    this.bookingError.set('');
    this.cancellingBooking.set(booking);
  }

  protected closeCancelBooking(): void {
    if (this.bookingSaving()) return;
    this.cancellingBooking.set(null);
  }

  protected cancelBooking(): void {
    const booking = this.cancellingBooking();
    if (!booking || this.bookingSaving() || this.cancellationNotes.invalid) return;
    this.bookingSaving.set(true);
    this.bookingError.set('');
    this.leads
      .cancelBooking(this.leadId, booking.id, {
        row_version: booking.row_version,
        notes: this.cancellationNotes.value.trim() || null,
      })
      .pipe(
        finalize(() => this.bookingSaving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ message }) => {
          this.cancellingBooking.set(null);
          this.notice.set(message || 'Booking cancelled.');
          this.loadBookings();
        },
        error: (error: unknown) =>
          this.bookingError.set(leadErrorDetails(error, 'Unable to cancel this booking.').message),
      });
  }

  protected openFollowUp(): void {
    if (!this.auth.hasPermission(PERMISSIONS.leadsUpdate)) return;
    this.detailTab.set('tasks');
    this.followUpRequest.update((request) => request + 1);
  }

  protected openCorrection(activity: LeadActivity): void {
    if (activity.is_system || !this.auth.hasPermission(PERMISSIONS.leadsUpdate)) return;
    this.correctingActivity.set(activity);
    this.activityForm.reset({
      activityType: activity.activity_type,
      channel: activity.channel,
      direction: activity.direction,
      occurredAt: localDateTimeValue(activity.occurred_at),
      performedBy: activity.performed_by || '',
      outcome: activity.outcome || '',
      notes: activity.notes || '',
      amendmentReason: '',
    });
    this.clearActivityMessages();
    this.activityModalOpen.set(true);
  }

  protected closeActivityModal(): void {
    if (this.activitySaving()) return;
    this.activityModalOpen.set(false);
    this.correctingActivity.set(null);
    this.clearActivityMessages();
  }

  protected saveActivity(): void {
    const correction = this.correctingActivity();
    const value = this.activityForm.getRawValue();
    if (value.activityType === 'note' && !value.notes.trim()) {
      this.activityFieldErrors.set({ notes: 'Notes are required for an internal note.' });
      this.activityForm.controls.notes.markAsTouched();
      return;
    }
    if (correction && !value.amendmentReason.trim()) {
      this.activityFieldErrors.set({
        amendment_reason: 'Explain why this correction is needed.',
      });
      this.activityForm.controls.amendmentReason.markAsTouched();
      return;
    }
    if (!correction && !value.performedBy) {
      this.activityFieldErrors.set({ performed_by: 'A performer is required.' });
      this.activityForm.controls.performedBy.markAsTouched();
      return;
    }
    if (this.activityForm.invalid || this.activitySaving()) {
      this.activityForm.markAllAsTouched();
      return;
    }

    const occurredAt = new Date(value.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      this.activityFieldErrors.set({ occurred_at: 'Enter a valid date and time.' });
      return;
    }
    const activity = {
      activity_type: value.activityType,
      channel: value.channel,
      direction: value.direction,
      occurred_at: occurredAt.toISOString(),
      performed_by: value.performedBy || null,
      outcome: value.outcome.trim() || null,
      notes: value.notes.trim() || null,
    };
    const operation = correction
      ? this.leads.amendActivity(this.leadId, correction.id, {
          amendment_reason: value.amendmentReason.trim(),
          ...activity,
        })
      : this.leads.createActivity(this.leadId, activity);

    this.activitySaving.set(true);
    this.clearActivityMessages();
    operation
      .pipe(
        finalize(() => this.activitySaving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ message }) => {
          this.activityModalOpen.set(false);
          this.correctingActivity.set(null);
          this.notice.set(message || (correction ? 'Correction recorded.' : 'Contact recorded.'));
          this.reloadActivities(1);
        },
        error: (error: unknown) => {
          const details = leadErrorDetails(error, 'Unable to record this activity.');
          this.activityError.set(details.message);
          this.activityFieldErrors.set(details.fieldErrors);
        },
      });
  }

  protected activityFieldError(field: string): string {
    const backend = this.activityFieldErrors()[field];
    if (backend) return backend;
    const formField = {
      activity_type: this.activityForm.controls.activityType,
      channel: this.activityForm.controls.channel,
      direction: this.activityForm.controls.direction,
      occurred_at: this.activityForm.controls.occurredAt,
      performed_by: this.activityForm.controls.performedBy,
      outcome: this.activityForm.controls.outcome,
      notes: this.activityForm.controls.notes,
      amendment_reason: this.activityForm.controls.amendmentReason,
    }[field];
    if (!formField || !(formField.touched || formField.dirty)) return '';
    if (formField.hasError('required')) return 'This field is required.';
    if (formField.hasError('maxlength')) return 'This value is too long.';
    return '';
  }

  protected replyFieldError(field: string): string {
    const backend = this.replyFieldErrors()[field];
    if (backend) return backend;
    const control = {
      channel: this.replyForm.controls.channel,
      occurred_at: this.replyForm.controls.occurredAt,
      related_outbound_activity_id: this.replyForm.controls.relatedActivityId,
      summary: this.replyForm.controls.summary,
    }[field];
    if (!control || !(control.touched || control.dirty)) return '';
    if (control.hasError('required')) return 'This field is required.';
    if (control.hasError('maxlength')) return 'This value is too long.';
    return '';
  }

  protected bookingFieldError(field: string): string {
    const backend = this.bookingFieldErrors()[field];
    if (backend) return backend;
    const control = {
      scheduled_at: this.bookingForm.controls.scheduledAt,
      timezone: this.bookingForm.controls.timezone,
      responsible_user_id: this.bookingForm.controls.responsibleUserId,
      status: this.bookingForm.controls.status,
      notes: this.bookingForm.controls.notes,
    }[field];
    if (!control || !(control.touched || control.dirty)) return '';
    if (control.hasError('required')) return 'This field is required.';
    if (control.hasError('maxlength')) return 'This value is too long.';
    return '';
  }

  protected assignmentFieldError(field: string): string {
    const backend = this.assignmentFieldErrors()[field];
    if (backend) return backend;
    const control = {
      assigned_user_id: this.assignmentForm.controls.newAssigneeId,
      assignment_reason: this.assignmentForm.controls.reason,
      pending_task_disposition: this.assignmentForm.controls.taskDisposition,
    }[field];
    if (!control || !(control.touched || control.dirty)) return '';
    if (control.hasError('required')) return 'This field is required.';
    if (control.hasError('maxlength')) return 'Keep the reason within 1,000 characters.';
    return '';
  }

  protected userName(userId: string | null): string {
    if (!userId) return 'Not specified';
    const current = this.auth.user();
    if (current?.id === userId) return current.name;
    return this.performerUsers().find((user) => user.id === userId)?.display_name || userId;
  }

  protected assigneeName(userId: string | null): string {
    return userId ? this.userName(userId) : 'Unassigned';
  }

  protected taskDispositionLabel(disposition: PendingTaskDisposition): string {
    return {
      transfer: 'Transferred to the new assignee',
      retain: 'Kept with their current owners',
      cancel: 'Cancelled',
    }[disposition];
  }

  protected activityTitle(activity: LeadActivity): string {
    return activity.is_amendment
      ? `Correction · ${this.label(activity.activity_type)}`
      : this.label(activity.activity_type);
  }

  protected outboundMessage(activity: LeadActivity): OutboundMessage | null {
    const messageId = activity.outbound_message_id;
    return messageId ? this.outboundMessages()[messageId] || null : null;
  }

  protected outboundStatusLabel(status: OutboundMessageStatus | string): string {
    if (status === 'queued') return 'Queued — not sent';
    if (status === 'sent') return 'Sent';
    if (status === 'unknown') return 'Unknown — uncertain outcome';
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  protected outboundFailureReason(message: OutboundMessage): string {
    const reason =
      [...message.events].reverse().find((event) => event.safe_reason)?.safe_reason ||
      message.failure_reason ||
      '';
    if (reason) return reason;
    if (message.status === 'unknown')
      return 'Delivery outcome is uncertain. This message will not be automatically resent.';
    if (message.status === 'failed')
      return 'Delivery failed. This message was not automatically resent.';
    return '';
  }

  protected handleOutboundMessage(message: OutboundMessage): void {
    const alreadyLoaded = Boolean(this.outboundMessages()[message.id]);
    this.outboundMessages.update((messages) => ({ ...messages, [message.id]: message }));
    this.activities.update((activities) =>
      activities.map((activity) =>
        activity.outbound_message_id === message.id
          ? {
              ...activity,
              message_status: message.status,
              message_events: message.events,
            }
          : activity,
      ),
    );
    if (!alreadyLoaded) this.reloadActivities(1);
  }

  protected bookingTitle(event: LeadBookingEvent): string {
    return {
      created: 'Booking recorded',
      confirmed: 'Booking confirmed',
      cancelled: 'Booking cancelled',
      rescheduled: 'Booking rescheduled',
    }[event.event_type];
  }

  protected canModifyBooking(booking: LeadBooking): boolean {
    return (
      this.auth.hasPermission(PERMISSIONS.leadsUpdate) &&
      (booking.status === 'scheduled' || booking.status === 'confirmed')
    );
  }

  protected formatScheduled(value: string, timezone: string): string {
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(value));
    } catch {
      return new Date(value).toLocaleString();
    }
  }

  protected updateStatus(): void {
    const lead = this.lead();
    const status = this.statusControl.value;
    if (!lead || !status || this.savingStatus()) return;
    this.savingStatus.set(true);
    this.errorMessage.set('');
    this.leads
      .update(lead.id, { row_version: lead.row_version, status })
      .pipe(
        finalize(() => this.savingStatus.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data, message }) => {
          this.lead.set(data);
          this.statusControl.setValue('');
          this.notice.set(message || 'Lead status updated.');
        },
        error: (error: unknown) =>
          this.errorMessage.set(leadErrorDetails(error, 'Unable to update lead status.').message),
      });
  }

  protected updatePriority(): void {
    const lead = this.lead();
    const priority = this.priorityControl.value;
    if (!lead || priority === lead.priority || this.savingPriority()) return;
    this.savingPriority.set(true);
    this.errorMessage.set('');
    this.leads
      .update(lead.id, { row_version: lead.row_version, priority })
      .pipe(
        finalize(() => this.savingPriority.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data, message }) => {
          this.lead.set(data);
          this.priorityControl.setValue(data.priority);
          this.notice.set(message || 'Lead priority updated.');
        },
        error: (error: unknown) => {
          const details = leadErrorDetails(error, 'Unable to update lead priority.');
          this.errorMessage.set(details.message);
          if (details.stale) this.refreshAfterConflict('priority');
        },
      });
  }

  protected archive(): void {
    const lead = this.lead();
    if (!lead || this.archiving()) return;
    this.archiving.set(true);
    this.leads
      .archive(lead.id, lead.row_version)
      .pipe(
        finalize(() => this.archiving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => void this.router.navigate(['/leads']),
        error: (error: unknown) => {
          this.archiveOpen.set(false);
          this.errorMessage.set(leadErrorDetails(error, 'Unable to archive the lead.').message);
        },
      });
  }

  protected externalUrl(url: string | null | undefined): string {
    return normalizeLeadUrl(url) || '';
  }

  protected country(value: string | null | undefined): string {
    return countryName(value);
  }

  protected hasSafeSocial(lead: Lead): boolean {
    return [
      lead.linkedin_url,
      lead.facebook_url,
      lead.instagram_url,
      lead.x_url,
      lead.github_url,
    ].some((url) => Boolean(this.externalUrl(url)));
  }

  private resetActivityForm(): void {
    this.activityForm.reset({
      activityType: 'initial_contact',
      channel: 'email',
      direction: 'outbound',
      occurredAt: localDateTimeValue(),
      performedBy: this.auth.user()?.id || '',
      outcome: '',
      notes: '',
      amendmentReason: '',
    });
  }

  private loadPerformerUsers(page = 1): void {
    if (page === 1) {
      this.performerUsers.set([]);
      this.performerUsersLoading.set(true);
    }
    this.settings
      .listUsers(page, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.performerUsers.update((users) => [
            ...users,
            ...data.items.filter(
              (candidate) =>
                candidate.is_active && !users.some((existing) => existing.id === candidate.id),
            ),
          ]);
          if (data.page * data.size < data.total) this.loadPerformerUsers(data.page + 1);
          else this.performerUsersLoading.set(false);
        },
        error: () => this.performerUsersLoading.set(false),
      });
  }

  private loadCustomerOptions(page = 1, accumulated: Customer[] = []): void {
    if (page === 1) {
      this.customerOptions.set([]);
      this.customerOptionsLoading.set(true);
    }
    this.customers
      .list(page, API_PAGE_SIZE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          const options = this.uniqueById([...accumulated, ...data.items]);
          if (data.page * data.size < data.total) {
            this.loadCustomerOptions(data.page + 1, options);
          } else {
            this.customerOptions.set(options);
            this.customerOptionsLoading.set(false);
          }
        },
        error: () => this.customerOptionsLoading.set(false),
      });
  }

  private loadCustomerLifecycle(lead: Lead): void {
    if (!this.auth.hasPermission(PERMISSIONS.customersView)) return;
    this.customerLifecycleLoading.set(true);
    this.loadAllCustomers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (candidates) => {
          if (!candidates.length) {
            this.customerLifecycleLoading.set(false);
            return;
          }
          forkJoin(candidates.map((customer) => this.customers.get(customer.id)))
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (responses) => {
                for (const { data: customer } of responses) {
                  const conversion = customer.conversions.find(
                    (candidate) => candidate.lead_id === lead.id,
                  );
                  if (conversion) {
                    this.customerLifecycle.set({ customer, conversion });
                    break;
                  }
                }
                this.customerLifecycleLoading.set(false);
              },
              error: () => this.customerLifecycleLoading.set(false),
            });
        },
        error: () => this.customerLifecycleLoading.set(false),
      });
  }

  private loadAllCustomers(): Observable<Customer[]> {
    return this.customers.list(1, API_PAGE_SIZE).pipe(
      expand(({ data }) =>
        data.page * data.size < data.total
          ? this.customers.list(data.page + 1, API_PAGE_SIZE)
          : EMPTY,
      ),
      map(({ data }) => data.items),
      reduce((customers, page) => this.uniqueById([...customers, ...page]), [] as Customer[]),
    );
  }

  private refreshLeadAfterConversion(): void {
    this.leads
      .get(this.leadId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.lead.set(data);
          this.priorityControl.setValue(data.priority);
        },
      });
  }

  private handleConversionError(error: unknown): void {
    const details = leadErrorDetails(error, 'Unable to convert this lead.');
    this.conversionError.set(details.message);
    this.conversionFieldErrors.set(details.fieldErrors);

    if (error instanceof HttpErrorResponse) {
      const detail = error.error?.detail;
      const existingCustomerId =
        detail && typeof detail === 'object' && !Array.isArray(detail)
          ? detail.existing_customer_id
          : null;
      if (typeof existingCustomerId === 'string') {
        this.conversionForm.patchValue({
          duplicateResolution: 'link_existing',
          existingCustomerId,
          confirmed: false,
        });
        this.conversionError.set(
          `${details.message}. Review the existing-customer link and confirm again.`,
        );
        if (
          this.auth.hasPermission(PERMISSIONS.customersView) &&
          !this.customerOptions().some((customer) => customer.id === existingCustomerId)
        ) {
          this.customers
            .get(existingCustomerId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: ({ data }) => this.customerOptions.update((items) => [...items, data]),
            });
        }
      }
    }
    if (details.stale) {
      this.refreshLeadAfterConversion();
      this.taskRefreshRequest.update((request) => request + 1);
      this.conversionError.set(
        'This lead changed in another session. The latest lead and task state has been refreshed.',
      );
    }
  }

  private loadOutboundMessageDetails(activities: readonly LeadActivity[]): void {
    if (!this.auth.hasPermission(PERMISSIONS.mailView)) return;
    const loaded = this.outboundMessages();
    const ids = [
      ...new Set(
        activities
          .map((activity) => activity.outbound_message_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
          .filter((id) => !loaded[id]),
      ),
    ];
    if (!ids.length) return;
    forkJoin(
      ids.map((id) =>
        this.outboundMessagesService.get(id).pipe(
          map(({ data }) => data),
          catchError(() => of(null)),
        ),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((messages) => {
        this.outboundMessages.update((current) => {
          const next = { ...current };
          for (const message of messages) if (message) next[message.id] = message;
          return next;
        });
      });
  }

  private loadAssignmentHistory(page = 1, accumulated: LeadAssignmentHistory[] = []): void {
    if (page === 1) {
      this.assignmentHistoryLoading.set(true);
      this.assignmentHistoryError.set('');
    }
    this.leads
      .listAssignmentHistory(this.leadId, page, API_PAGE_SIZE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          const history = this.uniqueById([...accumulated, ...data.items]);
          if (data.page * data.size < data.total) {
            this.loadAssignmentHistory(data.page + 1, history);
          } else {
            this.assignmentHistory.set(history);
            this.activityPage.set(Math.min(this.activityPage(), this.activityPageCount()));
            this.assignmentHistoryLoading.set(false);
          }
        },
        error: (error: unknown) => {
          this.assignmentHistoryLoading.set(false);
          this.assignmentHistoryError.set(
            leadErrorDetails(error, 'Unable to load assignment history.').message,
          );
        },
      });
  }

  private refreshAfterConflict(scope: 'assignment' | 'priority'): void {
    this.leads
      .get(this.leadId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.lead.set(data);
          this.priorityControl.setValue(data.priority);
          this.loadAssignmentHistory();
          this.taskRefreshRequest.update((request) => request + 1);
          const message =
            'This lead changed in another session. The latest assignee, priority, history, and tasks have been refreshed.';
          if (scope === 'assignment') this.assignmentError.set(message);
          else this.errorMessage.set(message);
        },
      });
  }

  private loadBookings(page = 1, accumulated: LeadBooking[] = []): void {
    if (page === 1) {
      this.bookingLoading.set(true);
      this.bookingError.set('');
    }
    this.leads
      .listBookings(this.leadId, page, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          const bookings = this.uniqueById([...accumulated, ...data.items]);
          if (data.page * data.size < data.total) {
            this.loadBookings(data.page + 1, bookings);
          } else {
            this.bookings.set(bookings);
            if (!bookings.length) {
              this.bookingEvents.set([]);
              this.bookingLoading.set(false);
              return;
            }
            forkJoin(bookings.map((booking) => this.loadBookingHistory(booking)))
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: (events) => {
                  this.bookingEvents.set(events.flat());
                  this.activityPage.set(Math.min(this.activityPage(), this.activityPageCount()));
                  this.bookingLoading.set(false);
                },
                error: (error: unknown) => {
                  this.bookingLoading.set(false);
                  this.bookingError.set(
                    leadErrorDetails(error, 'Unable to load booking history.').message,
                  );
                },
              });
          }
        },
        error: (error: unknown) => {
          this.bookingLoading.set(false);
          this.bookingError.set(leadErrorDetails(error, 'Unable to load bookings.').message);
        },
      });
  }

  private loadReplyActivities(page = 1, accumulated: LeadActivity[] = []): void {
    if (page === 1) {
      this.replyActivities.set([]);
      this.replyOptionsLoading.set(true);
    }
    this.leads
      .listActivities(this.leadId, page, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          const options = [
            ...accumulated,
            ...data.items.filter(
              (activity) => activity.direction === 'outbound' && !activity.is_amendment,
            ),
          ];
          if (data.page * data.size < data.total) {
            this.loadReplyActivities(data.page + 1, options);
          } else {
            this.replyActivities.set(options);
            this.replyOptionsLoading.set(false);
            if (options.length) this.replyForm.controls.relatedActivityId.setValue(options[0].id);
          }
        },
        error: (error: unknown) => {
          this.replyOptionsLoading.set(false);
          this.activityError.set(
            leadErrorDetails(error, 'Unable to load outbound activity references.').message,
          );
        },
      });
  }

  private loadBookingHistory(booking: LeadBooking): Observable<BookingTimelineRecord[]> {
    return this.leads.listBookingHistory(this.leadId, booking.id, 1, 100).pipe(
      expand(({ data }) =>
        data.page * data.size < data.total
          ? this.leads.listBookingHistory(this.leadId, booking.id, data.page + 1, 100)
          : EMPTY,
      ),
      map(({ data }) => data.items),
      reduce((events, page) => this.uniqueById([...events, ...page]), [] as LeadBookingEvent[]),
      map((events) =>
        events
          .sort((left, right) => this.compareBookingEvents(left, right))
          .map((event) => ({ booking, event })),
      ),
    );
  }

  private compareBookingEvents(left: LeadBookingEvent, right: LeadBookingEvent): number {
    return (
      new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime() ||
      right.id.localeCompare(left.id)
    );
  }

  private uniqueById<T extends { id: string }>(items: T[]): T[] {
    return [...new Map(items.map((item) => [item.id, item])).values()];
  }

  private clearActivityMessages(): void {
    this.activityError.set('');
    this.activityFieldErrors.set({});
  }
}
