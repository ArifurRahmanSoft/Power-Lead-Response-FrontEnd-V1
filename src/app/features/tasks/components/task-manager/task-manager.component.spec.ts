import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';

import { API_CONFIG } from '../../../../core/config/api.config';
import { AuthUser, PermissionKey, PERMISSIONS } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { LeadTask } from '../../models/task.models';
import { TaskManagerComponent } from './task-manager.component';

interface ExposedTaskManager {
  taskForm: FormGroup;
  completionForm: FormGroup;
  saving(): boolean;
  editorOpen(): boolean;
  canEditTask(task: LeadTask): boolean;
  saveTask(): void;
  openComplete(task: LeadTask): void;
  completeTask(): void;
}

const USER_ID = '11111111-1111-4111-8111-111111111111';

const user: AuthUser = {
  id: USER_ID,
  name: 'Current User',
  email: 'current@example.com',
  login_id: 'current.user',
};

function task(overrides: Partial<LeadTask> = {}): LeadTask {
  return {
    id: 'task-1',
    lead_id: 'lead-1',
    assigned_user_id: USER_ID,
    task_type: 'follow_up',
    title: 'Follow up with lead',
    notes: null,
    due_at: '2026-10-14T03:00:00Z',
    priority: 'high',
    status: 'pending',
    related_activity_id: null,
    completed_by: null,
    completed_at: null,
    cancelled_by: null,
    cancelled_at: null,
    created_by: USER_ID,
    created_at: '2026-10-13T03:00:00Z',
    updated_by: USER_ID,
    updated_at: '2026-10-13T03:00:00Z',
    row_version: 1,
    ...overrides,
  };
}

describe('TaskManagerComponent', () => {
  let fixture: ComponentFixture<TaskManagerComponent>;
  let component: ExposedTaskManager;
  let http: HttpTestingController;
  let permissions: Set<PermissionKey>;
  const role = signal('operator');

  beforeEach(() => {
    permissions = new Set([PERMISSIONS.leadsView, PERMISSIONS.leadsUpdate]);
    role.set('operator');
    TestBed.configureTestingModule({
      imports: [TaskManagerComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            user: signal<AuthUser | null>(user),
            role,
            hasPermission: (permission: PermissionKey) => permissions.has(permission),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TaskManagerComponent);
    fixture.componentRef.setInput('leadId', 'lead-1');
    fixture.detectChanges();
    component = fixture.componentInstance as unknown as ExposedTaskManager;
  });

  afterEach(() => http.verify());

  function flushTasks(items: LeadTask[] = []): void {
    http
      .expectOne(
        (request) =>
          request.url === `${API_CONFIG.baseUrl}/tasks` &&
          request.params.get('lead_id') === 'lead-1',
      )
      .flush({ success: true, data: { items, page: 1, size: 20, total: items.length } });
  }

  it('creates a timezone-aware follow-up once and defaults assignment to the current user', () => {
    flushTasks();
    fixture.componentRef.setInput('createRequest', 1);
    fixture.detectChanges();
    expect(component.editorOpen()).toBe(true);
    expect(component.taskForm.get('assignedUserId')?.value).toBe(USER_ID);
    component.taskForm.patchValue({ dueAt: '2026-10-14T09:00', title: 'Call again' });

    component.saveTask();
    component.saveTask();

    const request = http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/tasks`);
    expect(request.request.body).toEqual(
      expect.objectContaining({
        assigned_user_id: USER_ID,
        task_type: 'follow_up',
        title: 'Call again',
      }),
    );
    expect(request.request.body.due_at).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
    expect(component.saving()).toBe(true);
    request.flush({ success: true, message: 'Lead task created', data: task() });
    flushTasks([task()]);
  });

  it('blocks acquisition follow-ups for converted customers and allows service work', () => {
    flushTasks();
    fixture.componentRef.setInput('leadStatus', 'converted');
    fixture.detectChanges();
    flushTasks();
    fixture.componentRef.setInput('createRequest', 1);
    fixture.detectChanges();

    expect(component.taskForm.get('taskType')?.value).toBe('review');
    expect(component.taskForm.get('title')?.value).toBe('Customer service follow-up');

    component.taskForm.patchValue({ taskType: 'follow_up' });
    component.saveTask();
    http.expectNone(`${API_CONFIG.baseUrl}/leads/lead-1/tasks`);

    component.taskForm.patchValue({ taskType: 'review' });
    component.saveTask();
    const request = http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/tasks`);
    expect(request.request.body.task_type).toBe('review');
    request.flush({
      success: true,
      message: 'Lead task created',
      data: task({ task_type: 'review', title: 'Customer service follow-up' }),
    });
    flushTasks([task({ task_type: 'review', title: 'Customer service follow-up' })]);
  });

  it('completes a contact task by linking an existing contact activity once', () => {
    const contactTask = task({ task_type: 'contact' });
    flushTasks([contactTask]);
    component.openComplete(contactTask);
    http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/activities?page=1&size=100`).flush({
      success: true,
      data: {
        items: [
          {
            id: 'activity-1',
            lead_id: 'lead-1',
            activity_type: 'initial_contact',
            channel: 'phone',
            direction: 'outbound',
            occurred_at: '2026-10-13T04:00:00Z',
            performed_by: USER_ID,
            outcome: null,
            notes: null,
            related_activity_id: null,
            recorded_by: USER_ID,
            recorded_at: '2026-10-13T04:01:00Z',
            is_system: false,
            is_amendment: false,
            externally_performed: false,
            provider_verified: false,
            amendment_reason: null,
            email_delivery_verified: false,
          },
        ],
        page: 1,
        size: 100,
        total: 1,
      },
    });

    component.completeTask();
    component.completeTask();
    const request = http.expectOne(`${API_CONFIG.baseUrl}/tasks/task-1/complete`);
    expect(request.request.body).toEqual({ row_version: 1, related_activity_id: 'activity-1' });
    request.flush({
      success: true,
      message: 'Lead task completed',
      data: task({ status: 'completed' }),
    });
    flushTasks([task({ status: 'completed' })]);
  });

  it('atomically logs contact while completing without calling a message endpoint', () => {
    const contactTask = task({ task_type: 'follow_up' });
    flushTasks([contactTask]);
    component.openComplete(contactTask);
    http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/activities?page=1&size=100`).flush({
      success: true,
      data: { items: [], page: 1, size: 100, total: 0 },
    });
    component.completionForm.patchValue({
      mode: 'log',
      occurredAt: '2026-10-13T10:30',
      channel: 'phone',
      outcome: 'Spoke with the lead',
    });

    component.completeTask();
    const request = http.expectOne(`${API_CONFIG.baseUrl}/tasks/task-1/complete`);
    expect(request.request.body.activity).toEqual(
      expect.objectContaining({
        activity_type: 'follow_up',
        direction: 'outbound',
        performed_by: USER_ID,
      }),
    );
    expect(request.request.body.activity.occurred_at).toMatch(/Z$/);
    http.expectNone((candidate) => /mail|messages|send/.test(candidate.url));
    request.flush({
      success: true,
      message: 'Lead task completed',
      data: task({ status: 'completed' }),
    });
    flushTasks([task({ status: 'completed' })]);
  });

  it('does not expose writes for another staff member’s task', () => {
    role.set('staff');
    flushTasks();
    expect(component.canEditTask(task({ assigned_user_id: 'user-2' }))).toBe(false);
    expect(component.canEditTask(task({ assigned_user_id: USER_ID }))).toBe(true);
  });
});
