import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { API_CONFIG } from '../../../../core/config/api.config';
import { AuthUser, PERMISSIONS, PermissionKey } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { LeadConversionResult } from '../../../customers/models/customer.models';
import { OutboundMessage } from '../../../mail/models/outbound-message.models';
import {
  LeadActivity,
  LeadAssignmentHistory,
  LeadBooking,
  LeadBookingEvent,
  Lead,
} from '../../models/lead.models';
import { LeadDetailComponent } from './lead-detail.component';

interface ExposedLeadDetail {
  lead: WritableSignal<Lead | null>;
  emailEligibilityIssues(): readonly string[];
  activityForm: FormGroup;
  replyForm: FormGroup;
  bookingForm: FormGroup;
  assignmentForm: FormGroup;
  conversionForm: FormGroup;
  priorityControl: FormControl<string>;
  cancellationNotes: FormControl<string>;
  activityPage(): number;
  activityPageCount(): number;
  activityTotal(): number;
  timelineEntries(): Array<{
    kind: 'activity' | 'booking' | 'assignment';
    id: string;
    event?: LeadBookingEvent;
    assignment?: LeadAssignmentHistory;
    current?: boolean;
  }>;
  taskRefreshRequest(): number;
  conversionResult(): LeadConversionResult | null;
  outboundStatusLabel(status: string): string;
  outboundFailureReason(message: OutboundMessage): string;
  openLogContact(): void;
  openCorrection(activity: LeadActivity): void;
  openRecordReply(): void;
  openRecordBooking(): void;
  openReschedule(booking: LeadBooking): void;
  openCancelBooking(booking: LeadBooking): void;
  openAssignment(): void;
  saveActivity(): void;
  saveReply(): void;
  saveBooking(): void;
  cancelBooking(): void;
  saveAssignment(): void;
  saveConversion(): void;
  updatePriority(): void;
  loadActivities(page: number): void;
}

const currentUser: AuthUser = {
  id: 'user-1',
  login_id: 'owner',
  name: 'Workspace Owner',
  email: 'owner@example.com',
};

const lead = {
  id: 'lead-1',
  tracking_id: 'PL-001',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  email_status: 'valid',
  consent_status: 'unknown',
  status: 'new',
  priority: 'normal',
  source: 'manual',
  assigned_user_id: null,
  import_batch_id: null,
  created_at: '2026-10-12T08:00:00Z',
  created_by: 'user-1',
  updated_at: '2026-10-12T08:00:00Z',
  updated_by: 'user-1',
  row_version: 1,
};

function activity(overrides: Partial<LeadActivity> = {}): LeadActivity {
  return {
    id: 'activity-1',
    lead_id: 'lead-1',
    activity_type: 'initial_contact',
    channel: 'phone',
    direction: 'outbound',
    occurred_at: '2026-10-12T04:30:00Z',
    performed_by: 'user-1',
    outcome: 'Connected',
    notes: 'Called from an external phone.',
    related_activity_id: null,
    recorded_by: 'user-1',
    recorded_at: '2026-10-12T04:35:00Z',
    is_system: false,
    is_amendment: false,
    externally_performed: false,
    provider_verified: false,
    amendment_reason: null,
    email_delivery_verified: false,
    ...overrides,
  };
}

function booking(overrides: Partial<LeadBooking> = {}): LeadBooking {
  return {
    id: 'booking-1',
    lead_id: 'lead-1',
    scheduled_at: '2026-10-15T04:30:00Z',
    timezone: 'Asia/Dhaka',
    responsible_user_id: 'user-1',
    source: 'manual',
    status: 'scheduled',
    notes: 'Discovery call',
    provider_verified: false,
    created_by: 'user-1',
    created_at: '2026-10-13T04:00:00Z',
    updated_by: 'user-1',
    updated_at: '2026-10-13T04:00:00Z',
    row_version: 1,
    ...overrides,
  };
}

function bookingEvent(overrides: Partial<LeadBookingEvent> = {}): LeadBookingEvent {
  return {
    id: 'booking-event-1',
    event_type: 'created',
    previous_status: null,
    new_status: 'scheduled',
    previous_scheduled_at: null,
    new_scheduled_at: '2026-10-15T04:30:00Z',
    previous_timezone: null,
    new_timezone: 'Asia/Dhaka',
    notes: 'Discovery call',
    recorded_by: 'user-1',
    recorded_at: '2026-10-13T04:00:00Z',
    ...overrides,
  };
}

function assignmentHistory(overrides: Partial<LeadAssignmentHistory> = {}): LeadAssignmentHistory {
  return {
    id: 'assignment-1',
    lead_id: 'lead-1',
    previous_assignee_id: 'user-1',
    new_assignee_id: 'user-2',
    actor_user_id: 'user-1',
    assigned_at: '2026-10-14T04:00:00Z',
    reason: 'Balance the active workload',
    task_disposition: 'transfer',
    affected_task_count: 2,
    lead_row_version: 2,
    ...overrides,
  };
}

describe('LeadDetailComponent activity timeline', () => {
  let fixture: ComponentFixture<LeadDetailComponent>;
  let component: ExposedLeadDetail;
  let http: HttpTestingController;
  let permissions: Set<PermissionKey>;

  beforeEach(() => {
    permissions = new Set([PERMISSIONS.leadsView, PERMISSIONS.leadsUpdate]);
    TestBed.configureTestingModule({
      imports: [LeadDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: 'lead-1' }),
              queryParamMap: convertToParamMap({}),
            },
          },
        },
        {
          provide: AuthService,
          useValue: {
            user: signal<AuthUser | null>(currentUser),
            hasPermission: (permission: PermissionKey) => permissions.has(permission),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LeadDetailComponent);
    component = fixture.componentInstance as unknown as ExposedLeadDetail;
    fixture.detectChanges();
    http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1`).flush({ success: true, data: lead });
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/bookings?page=1&size=100`)
      .flush({ success: true, data: { items: [], page: 1, size: 100, total: 0 } });
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/assignment-history?page=1&size=100`)
      .flush({ success: true, data: { items: [], page: 1, size: 100, total: 0 } });
  });

  afterEach(() => http.verify());

  function flushTimeline(items: LeadActivity[] = [], total = items.length, page = 1): void {
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/activities?page=${page}&size=100`)
      .flush({ success: true, data: { items, page, size: 100, total } });
    fixture.detectChanges();
  }

  it('blocks only explicitly denied lead consent without calling unknown or empty consent granted', () => {
    flushTimeline();
    expect(component.emailEligibilityIssues()).toEqual([]);

    component.lead.set({ ...lead, consent_status: '' } as unknown as Lead);
    expect(component.emailEligibilityIssues()).toEqual([]);

    component.lead.set({ ...lead, consent_status: 'denied' } as unknown as Lead);
    expect(component.emailEligibilityIssues()).toEqual([
      'Lead email consent is explicitly denied.',
    ]);

    component.lead.set({ ...lead, consent_status: 'withdrawn' } as unknown as Lead);
    expect(component.emailEligibilityIssues()).toEqual(['Lead email consent was withdrawn.']);
  });

  it('labels backend message outcomes without conflating them with contact type', () => {
    flushTimeline();
    const message = {
      id: 'message-1',
      status: 'unknown',
      contact_stage: 'follow_up',
      failure_reason: null,
      events: [],
    } as unknown as OutboundMessage;

    expect(component.outboundStatusLabel('sent')).toBe('Sent');
    expect(component.outboundStatusLabel('queued')).toBe('Queued — not sent');
    expect(component.outboundStatusLabel(message.status)).toBe('Unknown — uncertain outcome');
    expect(message.contact_stage).toBe('follow_up');
    expect(component.outboundFailureReason(message)).toBe(
      'Delivery outcome is uncertain. This message will not be automatically resent.',
    );

    message.status = 'failed';
    message.events = [
      {
        status: 'failed',
        safe_reason: 'Mailbox rejected the message',
        occurred_at: '2026-10-15T04:30:00Z',
      },
    ];
    expect(component.outboundFailureReason(message)).toBe('Mailbox rejected the message');
  });

  it('defaults the performer to the current user and posts a timezone-aware record only', () => {
    flushTimeline();
    component.openLogContact();
    component.activityForm.patchValue({
      activityType: 'follow_up',
      channel: 'phone',
      occurredAt: '2026-10-13T10:30',
      outcome: 'Requested another call',
      notes: 'No message was sent.',
    });

    component.saveActivity();

    const request = http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/activities`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.performed_by).toBe('user-1');
    expect(request.request.body.direction).toBe('outbound');
    expect(request.request.body.occurred_at).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
    expect(request.request.url).not.toContain('mail');
    request.flush({ success: true, message: 'Lead activity recorded', data: activity() });
    flushTimeline([activity()]);
  });

  it('loads requested history pages and records an authorized correction as an amendment', () => {
    const original = activity();
    const history = Array.from({ length: 12 }, (_, index) =>
      activity({ id: `activity-${index + 1}` }),
    );
    flushTimeline(history, 12);
    expect(component.activityPageCount()).toBe(2);

    component.loadActivities(2);
    expect(component.activityPage()).toBe(2);

    component.openCorrection(original);
    component.activityForm.patchValue({
      outcome: 'Follow-up requested',
      amendmentReason: 'Corrected the outcome from the call notes',
    });
    component.saveActivity();

    const request = http.expectOne(
      `${API_CONFIG.baseUrl}/leads/lead-1/activities/activity-1/amendments`,
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(
      expect.objectContaining({
        amendment_reason: 'Corrected the outcome from the call notes',
        outcome: 'Follow-up requested',
      }),
    );
    request.flush({
      success: true,
      message: 'Lead activity amendment recorded',
      data: activity({ id: 'activity-2', is_amendment: true }),
    });
    flushTimeline([activity({ id: 'activity-13', is_amendment: true }), ...history], 13);
  });

  it('does not request the workspace user list without backend list permission', () => {
    flushTimeline();
    http.expectNone(`${API_CONFIG.baseUrl}/settings/users?page=1&size=100`);
    expect(component.activityForm.get('performedBy')?.value).toBe('user-1');
  });

  it('records a linked reply without changing the lead or sending a message', () => {
    const outbound = activity();
    flushTimeline([outbound]);
    component.openRecordReply();
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/activities?page=1&size=100`)
      .flush({ success: true, data: { items: [outbound], page: 1, size: 100, total: 1 } });
    component.replyForm.patchValue({
      channel: 'email',
      occurredAt: '2026-10-13T14:30',
      summary: 'Confirmed the requested meeting time.',
    });

    component.saveReply();

    const request = http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/replies`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.related_outbound_activity_id).toBe('activity-1');
    expect(request.request.body.occurred_at).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
    expect(request.request.url).not.toContain('mail');
    request.flush({
      success: true,
      message: 'Manual reply recorded',
      data: {
        id: 'reply-1',
        lead_id: 'lead-1',
        channel: 'email',
        occurred_at: '2026-10-13T08:30:00Z',
        summary: 'Confirmed the requested meeting time.',
        related_outbound_activity_id: 'activity-1',
        recorded_by: 'user-1',
        recorded_at: '2026-10-13T08:31:00Z',
        provider_verified: false,
      },
    });
    flushTimeline([activity({ id: 'reply-activity', activity_type: 'inbound_reply' })]);
    http.expectNone(`${API_CONFIG.baseUrl}/leads/lead-1`);
  });

  it('records a manual booking in the user timezone and prevents duplicate submission', () => {
    flushTimeline();
    component.openRecordBooking();
    component.bookingForm.patchValue({
      scheduledAt: '2026-10-15T10:30',
      notes: 'Discovery call',
    });

    component.saveBooking();
    component.saveBooking();

    const request = http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/bookings`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(
      expect.objectContaining({
        responsible_user_id: 'user-1',
        source: 'manual',
        status: 'scheduled',
      }),
    );
    expect(request.request.body.scheduled_at).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
    expect(request.request.body.timezone).toBeTruthy();
    request.flush({ success: true, message: 'Booking recorded', data: booking() });
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/bookings?page=1&size=100`)
      .flush({ success: true, data: { items: [booking()], page: 1, size: 100, total: 1 } });
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/bookings/booking-1/history?page=1&size=100`)
      .flush({
        success: true,
        data: { items: [bookingEvent()], page: 1, size: 100, total: 1 },
      });
    http.expectNone(`${API_CONFIG.baseUrl}/leads/lead-1`);
  });

  it('uses row versions for authorized booking rescheduling and cancellation', () => {
    flushTimeline();
    const scheduled = booking({ row_version: 4 });
    component.openReschedule(scheduled);
    component.bookingForm.patchValue({ scheduledAt: '2026-10-16T11:00', notes: 'New time' });
    component.saveBooking();

    const reschedule = http.expectOne(
      `${API_CONFIG.baseUrl}/leads/lead-1/bookings/booking-1/reschedule`,
    );
    expect(reschedule.request.body.row_version).toBe(4);
    expect(reschedule.request.body.scheduled_at).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
    const rescheduled = booking({ row_version: 5, updated_at: '2026-10-13T05:00:00Z' });
    reschedule.flush({ success: true, message: 'Booking rescheduled', data: rescheduled });
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/bookings?page=1&size=100`)
      .flush({ success: true, data: { items: [rescheduled], page: 1, size: 100, total: 1 } });
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/bookings/booking-1/history?page=1&size=100`)
      .flush({
        success: true,
        data: {
          items: [bookingEvent({ event_type: 'rescheduled', id: 'booking-event-2' })],
          page: 1,
          size: 100,
          total: 1,
        },
      });

    component.openCancelBooking(rescheduled);
    component.cancellationNotes.setValue('Customer requested cancellation');
    component.cancelBooking();
    const cancellation = http.expectOne(
      `${API_CONFIG.baseUrl}/leads/lead-1/bookings/booking-1/cancel`,
    );
    expect(cancellation.request.body).toEqual({
      row_version: 5,
      notes: 'Customer requested cancellation',
    });
    cancellation.flush({
      success: true,
      message: 'Booking cancelled',
      data: booking({ status: 'cancelled', row_version: 6 }),
    });
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/bookings?page=1&size=100`)
      .flush({ success: true, data: { items: [], page: 1, size: 100, total: 0 } });
  });

  it('loads every booking-history page, preserves descending order, and removes duplicates', () => {
    flushTimeline();
    component.openRecordBooking();
    component.bookingForm.patchValue({ scheduledAt: '2026-10-15T10:30' });
    component.saveBooking();
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/bookings`)
      .flush({ success: true, data: booking() });
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/bookings?page=1&size=100`)
      .flush({ success: true, data: { items: [booking()], page: 1, size: 100, total: 1 } });

    const latest = bookingEvent({
      id: 'event-z',
      event_type: 'rescheduled',
      recorded_at: '2026-10-14T04:00:00Z',
    });
    const created = bookingEvent({ id: 'event-a' });
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/bookings/booking-1/history?page=1&size=100`)
      .flush({ success: true, data: { items: [latest], page: 1, size: 100, total: 101 } });
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/bookings/booking-1/history?page=2&size=100`)
      .flush({
        success: true,
        data: { items: [latest, created], page: 2, size: 100, total: 101 },
      });

    const entries = component.timelineEntries();
    expect(component.activityTotal()).toBe(2);
    expect(entries.map((entry) => entry.event?.id)).toEqual(['event-z', 'event-a']);
    expect(entries.filter((entry) => entry.current)).toHaveLength(1);
    expect(entries[0].current).toBe(true);
  });

  it('transfers responsibility with the selected pending-task disposition and adds history', () => {
    flushTimeline();
    permissions.add(PERMISSIONS.leadsAssign);
    permissions.add(PERMISSIONS.settingsUsersView);
    const raw = fixture.componentInstance as any;
    raw.performerUsers.set([
      {
        id: 'user-1',
        display_name: 'Workspace Owner',
        role_name: 'Owner',
        is_active: true,
      },
      {
        id: 'user-2',
        display_name: 'Second Owner',
        role_name: 'Operator',
        is_active: true,
      },
    ]);

    component.openAssignment();
    component.assignmentForm.patchValue({
      newAssigneeId: 'user-2',
      reason: 'Balance the active workload',
      taskDisposition: 'transfer',
    });
    component.saveAssignment();

    const request = http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      row_version: 1,
      assigned_user_id: 'user-2',
      assignment_reason: 'Balance the active workload',
      pending_task_disposition: 'transfer',
    });
    request.flush({
      success: true,
      message: 'Lead updated',
      data: { ...lead, assigned_user_id: 'user-2', row_version: 2 },
    });
    http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/assignment-history?page=1&size=100`).flush({
      success: true,
      data: { items: [assignmentHistory()], page: 1, size: 100, total: 1 },
    });

    expect(component.taskRefreshRequest()).toBe(1);
    expect(component.timelineEntries().some((entry) => entry.kind === 'assignment')).toBe(true);
  });

  it('refreshes the current lead, history, and scoped tasks after a stale priority update', () => {
    flushTimeline();
    component.priorityControl.setValue('high');
    component.updatePriority();

    const update = http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1`);
    expect(update.request.body).toEqual({ row_version: 1, priority: 'high' });
    update.flush(
      { detail: 'Lead was modified by another request' },
      { status: 409, statusText: 'Conflict' },
    );
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1`)
      .flush({ success: true, data: { ...lead, priority: 'urgent', row_version: 2 } });
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/assignment-history?page=1&size=100`)
      .flush({ success: true, data: { items: [], page: 1, size: 100, total: 0 } });

    expect(component.priorityControl.value).toBe('urgent');
    expect(component.taskRefreshRequest()).toBe(1);
  });

  it('converts an engaged lead explicitly and displays the backend result without messaging', () => {
    flushTimeline();
    const raw = fixture.componentInstance as any;
    raw.lead.set({ ...lead, status: 'engaged', service_requested: 'Website Design' });
    component.conversionForm.patchValue({
      purchasedService: 'Website Design',
      reference: 'ORDER-1042',
      reason: 'Signed service agreement',
      duplicateResolution: 'create_new',
      pendingTaskDisposition: 'cancel',
      pendingTaskReason: 'Acquisition completed after conversion',
      confirmed: true,
    });

    component.saveConversion();

    const request = http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/convert`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      row_version: 1,
      purchased_service: 'Website Design',
      reference: 'ORDER-1042',
      reason: 'Signed service agreement',
      duplicate_resolution: 'create_new',
      pending_acquisition_task_disposition: 'cancel',
      pending_task_reason: 'Acquisition completed after conversion',
    });
    expect(request.request.url).not.toMatch(/mail|message|send/);
    request.flush({
      success: true,
      message: 'Lead converted to customer',
      data: {
        idempotent_replay: false,
        customer: {
          id: 'customer-1',
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone: null,
          company: null,
          communication_purpose: 'customer_relationship',
          communication_consent_status: 'unknown',
          channel_restrictions: [],
          suppressed_at: null,
          suppression_reason: null,
          created_at: '2026-10-14T06:00:00Z',
          row_version: 1,
        },
        conversion: {
          id: 'conversion-1',
          lead_id: 'lead-1',
          customer_id: 'customer-1',
          converted_at: '2026-10-14T06:00:00Z',
          converted_by: 'user-1',
          purchased_service: 'Website Design',
          reference: 'ORDER-1042',
          reason: 'Signed service agreement',
          duplicate_resolution: 'create_new',
          pending_task_disposition: 'cancel',
          pending_task_reason: 'Acquisition completed after conversion',
          cancelled_nurture_job_count: 2,
          affected_task_count: 1,
          source_consent_status: 'unknown',
          source_consent_evidence: null,
          source_consent_reference: null,
        },
      },
    });
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/lead-1`)
      .flush({ success: true, data: { ...lead, status: 'converted', row_version: 2 } });

    expect(component.conversionResult()?.customer.id).toBe('customer-1');
    expect(component.conversionResult()?.conversion.cancelled_nurture_job_count).toBe(2);
    expect(component.taskRefreshRequest()).toBe(1);
    http.expectNone((candidate) => /mail|messages|send/.test(candidate.url));
  });

  it('offers the backend duplicate customer for an explicit confirmed retry', () => {
    flushTimeline();
    const raw = fixture.componentInstance as any;
    raw.lead.set({ ...lead, status: 'engaged' });
    component.conversionForm.patchValue({
      purchasedService: 'Support',
      reason: 'Purchased support',
      duplicateResolution: 'create_new',
      pendingTaskDisposition: 'retain',
      pendingTaskReason: 'Keep the intentional callback',
      confirmed: true,
    });

    component.saveConversion();
    http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/convert`).flush(
      {
        detail: {
          message: 'A customer with this email already exists; retry with link_existing',
          existing_customer_id: 'customer-existing',
        },
      },
      { status: 409, statusText: 'Conflict' },
    );

    expect(component.conversionForm.get('duplicateResolution')?.value).toBe('link_existing');
    expect(component.conversionForm.get('existingCustomerId')?.value).toBe('customer-existing');
    expect(component.conversionForm.get('confirmed')?.value).toBe(false);
  });
});
