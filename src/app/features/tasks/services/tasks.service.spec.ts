import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { TasksService } from './tasks.service';

describe('TasksService', () => {
  let service: TasksService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TasksService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TasksService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uses backend task views and timezone filters', () => {
    service.list(2, 20, { due_today: true, timezone: 'Asia/Dhaka', status: '' }).subscribe();
    const request = http.expectOne(
      `${API_CONFIG.baseUrl}/tasks?page=2&size=20&due_today=true&timezone=Asia/Dhaka`,
    );
    expect(request.request.method).toBe('GET');
    request.flush({ success: true, data: { items: [], page: 2, size: 20, total: 0 } });
  });

  it('uses versioned create, update, cancel, and complete endpoints', () => {
    const payload = {
      assigned_user_id: 'user-1',
      task_type: 'follow_up' as const,
      title: 'Follow up',
      notes: null,
      due_at: '2026-10-14T04:30:00.000Z',
      priority: 'high' as const,
    };
    service.create('lead-1', payload).subscribe();
    const create = http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/tasks`);
    expect(create.request.body).toEqual(payload);
    create.flush({ success: true, data: {} });

    service.update('task-1', { row_version: 2, title: 'Updated' }).subscribe();
    const update = http.expectOne(`${API_CONFIG.baseUrl}/tasks/task-1`);
    expect(update.request.method).toBe('PATCH');
    update.flush({ success: true, data: {} });

    service.cancel('task-1', 3).subscribe();
    const cancel = http.expectOne(`${API_CONFIG.baseUrl}/tasks/task-1/cancel`);
    expect(cancel.request.body).toEqual({ row_version: 3 });
    cancel.flush({ success: true, data: {} });

    service.complete('task-1', { row_version: 4, related_activity_id: 'activity-1' }).subscribe();
    const complete = http.expectOne(`${API_CONFIG.baseUrl}/tasks/task-1/complete`);
    expect(complete.request.body).toEqual({ row_version: 4, related_activity_id: 'activity-1' });
    complete.flush({ success: true, data: {} });
  });
});
