import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { PERMISSIONS } from '../../../../core/models/auth.models';
import { SettingsUser } from '../../../../core/models/settings.models';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import {
  LEAD_ACTIVITY_CHANNELS,
  LeadActivity,
  LeadActivityDirection,
  LeadActivityType,
  LeadStatus,
} from '../../../leads/models/lead.models';
import { catalogLabel } from '../../../leads/models/lead-catalogs';
import { leadErrorDetails } from '../../../leads/services/lead-errors';
import { LeadsService } from '../../../leads/services/leads.service';
import {
  LEAD_TASK_PRIORITIES,
  LEAD_TASK_STATUSES,
  LEAD_TASK_TYPES,
  LeadTask,
  LeadTaskStatus,
  LeadTaskType,
  TaskFilters,
  TaskView,
} from '../../models/task.models';
import { TasksService } from '../../services/tasks.service';

const PAGE_SIZE = 20;
const CONTACT_TASK_TYPES: readonly LeadTaskType[] = ['contact', 'follow_up'];
const CONTACT_ACTIVITY_TYPES: readonly LeadActivityType[] = [
  'initial_contact',
  'follow_up',
  'inbound_reply',
];
const ACTIVITY_DIRECTION: Readonly<Record<LeadActivityType, LeadActivityDirection>> = {
  initial_contact: 'outbound',
  follow_up: 'outbound',
  inbound_reply: 'inbound',
  note: 'internal',
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function localDateTimeValue(value: string | Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function tomorrowLocalValue(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return localDateTimeValue(tomorrow);
}

@Component({
  selector: 'app-task-manager',
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './task-manager.component.html',
  styleUrl: './task-manager.component.css',
})
export class TaskManagerComponent {
  readonly leadId = input<string | null>(null);
  readonly leadStatus = input<LeadStatus | null>(null);
  readonly view = input<TaskView>('lead');
  readonly createRequest = input(0);
  readonly refreshRequest = input(0);

  private readonly tasksService = inject(TasksService);
  private readonly leadsService = inject(LeadsService);
  private readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  protected readonly permissions = PERMISSIONS;

  protected readonly tasks = signal<LeadTask[]>([]);
  protected readonly users = signal<SettingsUser[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly notice = signal('');
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly editorTask = signal<LeadTask | null>(null);
  protected readonly editorOpen = signal(false);
  protected readonly cancelCandidate = signal<LeadTask | null>(null);
  protected readonly completionTask = signal<LeadTask | null>(null);
  protected readonly activities = signal<LeadActivity[]>([]);
  protected readonly activitiesLoading = signal(false);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly label = catalogLabel;
  protected readonly taskTypes = computed(() =>
    this.leadStatus() === 'converted' && !this.editorTask()
      ? LEAD_TASK_TYPES.filter((type) => type === 'review' || type === 'other')
      : LEAD_TASK_TYPES,
  );
  protected readonly priorities = LEAD_TASK_PRIORITIES;
  protected readonly statuses = LEAD_TASK_STATUSES.filter(
    (status): status is 'pending' | 'in_progress' =>
      status === 'pending' || status === 'in_progress',
  );
  protected readonly activityChannels = LEAD_ACTIVITY_CHANNELS;
  protected readonly contactActivityTypes = CONTACT_ACTIVITY_TYPES;
  protected readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  protected readonly canChooseAssignee = computed(
    () =>
      this.auth.hasPermission(PERMISSIONS.leadsAssign) &&
      this.auth.hasPermission(PERMISSIONS.settingsUsersView),
  );
  protected readonly canAssign = computed(() => this.auth.hasPermission(PERMISSIONS.leadsAssign));
  protected readonly canMutate = computed(() => this.auth.hasPermission(PERMISSIONS.leadsUpdate));

  protected readonly filters = new FormGroup({
    status: new FormControl<LeadTaskStatus | ''>('', { nonNullable: true }),
    taskType: new FormControl<LeadTaskType | ''>('', { nonNullable: true }),
    priority: new FormControl<(typeof LEAD_TASK_PRIORITIES)[number] | ''>('', {
      nonNullable: true,
    }),
  });

  protected readonly taskForm = new FormGroup({
    taskType: new FormControl<LeadTaskType>('follow_up', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(10_000)] }),
    dueAt: new FormControl(tomorrowLocalValue(), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    priority: new FormControl<(typeof LEAD_TASK_PRIORITIES)[number]>('medium', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    status: new FormControl<'pending' | 'in_progress'>('pending', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    assignedUserId: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(UUID_PATTERN)],
    }),
  });

  protected readonly completionForm = new FormGroup({
    mode: new FormControl<'existing' | 'log'>('existing', { nonNullable: true }),
    activityId: new FormControl('', { nonNullable: true }),
    activityType: new FormControl<LeadActivityType>('follow_up', { nonNullable: true }),
    channel: new FormControl<(typeof LEAD_ACTIVITY_CHANNELS)[number]>('phone', {
      nonNullable: true,
    }),
    direction: new FormControl<LeadActivityDirection>(
      { value: 'outbound', disabled: true },
      { nonNullable: true },
    ),
    occurredAt: new FormControl(localDateTimeValue(), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    outcome: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(10_000)] }),
  });

  constructor() {
    effect(() => {
      this.leadId();
      this.leadStatus();
      this.view();
      this.refreshRequest();
      untracked(() => this.load(1));
    });
    effect(() => {
      const request = this.createRequest();
      if (request > 0) untracked(() => this.openCreate());
    });
    this.completionForm.controls.activityType.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((type) =>
        this.completionForm.controls.direction.setValue(ACTIVITY_DIRECTION[type]),
      );
    if (this.auth.hasPermission(PERMISSIONS.settingsUsersView)) this.loadUsers();
  }

  protected load(page = this.page()): void {
    if (page < 1 || page > this.pageCount()) return;
    this.loading.set(true);
    this.errorMessage.set('');
    this.tasksService
      .list(page, PAGE_SIZE, this.currentFilters())
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.tasks.set(data.items);
          this.page.set(data.page);
          this.total.set(data.total);
        },
        error: (error: unknown) =>
          this.errorMessage.set(leadErrorDetails(error, 'Unable to load tasks.').message),
      });
  }

  protected applyFilters(): void {
    this.load(1);
  }

  protected clearFilters(): void {
    this.filters.reset();
    this.load(1);
  }

  public openCreate(): void {
    const leadId = this.leadId();
    if (!leadId || !this.canMutate() || this.saving()) return;
    this.editorTask.set(null);
    this.taskForm.reset({
      taskType: this.leadStatus() === 'converted' ? 'review' : 'follow_up',
      title:
        this.leadStatus() === 'converted' ? 'Customer service follow-up' : 'Follow up with lead',
      notes: '',
      dueAt: tomorrowLocalValue(),
      priority: 'medium',
      status: 'pending',
      assignedUserId: this.auth.user()?.id || '',
    });
    this.clearMutationErrors();
    this.editorOpen.set(true);
  }

  protected openEdit(task: LeadTask): void {
    if (!this.canEditTask(task) || this.isTerminal(task) || this.saving()) return;
    this.editorTask.set(task);
    this.taskForm.reset({
      taskType: task.task_type,
      title: task.title,
      notes: task.notes || '',
      dueAt: localDateTimeValue(task.due_at),
      priority: task.priority,
      status: task.status === 'in_progress' ? 'in_progress' : 'pending',
      assignedUserId: task.assigned_user_id,
    });
    this.clearMutationErrors();
    this.editorOpen.set(true);
  }

  protected closeEditor(): void {
    if (this.saving()) return;
    this.editorOpen.set(false);
    this.editorTask.set(null);
    this.clearMutationErrors();
  }

  protected saveTask(): void {
    if (this.saving()) return;
    if (this.taskForm.invalid) {
      this.taskForm.markAllAsTouched();
      return;
    }
    const leadId = this.leadId();
    const editing = this.editorTask();
    if (!editing && !leadId) return;
    const value = this.taskForm.getRawValue();
    if (
      !editing &&
      this.leadStatus() === 'converted' &&
      (value.taskType === 'contact' || value.taskType === 'follow_up')
    ) {
      this.fieldErrors.set({
        task_type: 'Converted customers cannot receive new lead-acquisition tasks.',
      });
      return;
    }
    const dueAt = new Date(value.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      this.fieldErrors.set({ due_at: 'Enter a valid due date and time.' });
      return;
    }
    const fields = {
      assigned_user_id: value.assignedUserId,
      task_type: value.taskType,
      title: value.title.trim(),
      notes: value.notes.trim() || null,
      due_at: dueAt.toISOString(),
      priority: value.priority,
    };
    const operation = editing
      ? this.tasksService.update(editing.id, {
          row_version: editing.row_version,
          ...fields,
          status: value.status,
        })
      : this.tasksService.create(leadId!, fields);
    this.runMutation(
      operation,
      editing ? 'Unable to update the task.' : 'Unable to create the task.',
      () => {
        this.editorOpen.set(false);
        this.editorTask.set(null);
      },
    );
  }

  protected cancelTask(): void {
    const task = this.cancelCandidate();
    if (!task || this.saving()) return;
    this.runMutation(
      this.tasksService.cancel(task.id, task.row_version),
      'Unable to cancel the task.',
      () => this.cancelCandidate.set(null),
    );
  }

  protected openComplete(task: LeadTask): void {
    if (!this.canEditTask(task) || this.isTerminal(task) || this.saving()) return;
    this.completionTask.set(task);
    this.activities.set([]);
    this.completionForm.reset({
      mode: 'existing',
      activityId: task.related_activity_id || '',
      activityType: task.task_type === 'follow_up' ? 'follow_up' : 'initial_contact',
      channel: 'phone',
      direction: 'outbound',
      occurredAt: localDateTimeValue(),
      outcome: '',
      notes: '',
    });
    this.clearMutationErrors();
    if (this.isContactTask(task)) this.loadActivities(task);
  }

  protected closeCompletion(): void {
    if (this.saving()) return;
    this.completionTask.set(null);
    this.activities.set([]);
    this.clearMutationErrors();
  }

  protected completeTask(): void {
    const task = this.completionTask();
    if (!task || this.saving()) return;
    const request: {
      row_version: number;
      related_activity_id?: string;
      activity?: {
        activity_type: LeadActivityType;
        channel: (typeof LEAD_ACTIVITY_CHANNELS)[number];
        direction: LeadActivityDirection;
        occurred_at: string;
        performed_by: string;
        outcome: string | null;
        notes: string | null;
      };
    } = { row_version: task.row_version };
    if (this.isContactTask(task)) {
      const value = this.completionForm.getRawValue();
      if (value.mode === 'existing') {
        if (!value.activityId) {
          this.fieldErrors.set({ related_activity_id: 'Select a contact activity.' });
          return;
        }
        request.related_activity_id = value.activityId;
      } else {
        if (this.completionForm.invalid) {
          this.completionForm.markAllAsTouched();
          return;
        }
        const occurredAt = new Date(value.occurredAt);
        if (Number.isNaN(occurredAt.getTime())) {
          this.fieldErrors.set({ occurred_at: 'Enter a valid occurred date and time.' });
          return;
        }
        request.activity = {
          activity_type: value.activityType,
          channel: value.channel,
          direction: value.direction,
          occurred_at: occurredAt.toISOString(),
          performed_by: this.auth.user()?.id || '',
          outcome: value.outcome.trim() || null,
          notes: value.notes.trim() || null,
        };
      }
    }
    this.runMutation(
      this.tasksService.complete(task.id, request),
      'Unable to complete the task.',
      () => {
        this.completionTask.set(null);
        this.activities.set([]);
      },
    );
  }

  protected isContactTask(task: LeadTask): boolean {
    return CONTACT_TASK_TYPES.includes(task.task_type);
  }

  protected isTerminal(task: LeadTask): boolean {
    return task.status === 'completed' || task.status === 'cancelled';
  }

  protected canEditTask(task: LeadTask): boolean {
    return (
      this.canMutate() &&
      (this.auth.role() !== 'staff' || task.assigned_user_id === this.auth.user()?.id)
    );
  }

  protected isOverdue(task: LeadTask): boolean {
    return !this.isTerminal(task) && new Date(task.due_at).getTime() < Date.now();
  }

  protected assigneeName(id: string): string {
    if (id === this.auth.user()?.id) return `${this.auth.user()?.name} (you)`;
    return this.users().find((user) => user.id === id)?.display_name || id;
  }

  protected fieldError(field: string): string {
    const backend = this.fieldErrors()[field];
    if (backend) return backend;
    const aliases: Record<string, FormControl> = {
      task_type: this.taskForm.controls.taskType,
      title: this.taskForm.controls.title,
      notes: this.taskForm.controls.notes,
      due_at: this.taskForm.controls.dueAt,
      priority: this.taskForm.controls.priority,
      assigned_user_id: this.taskForm.controls.assignedUserId,
    };
    const control = aliases[field];
    if (!control || !(control.touched || control.dirty)) return '';
    if (control.hasError('required')) return 'This field is required.';
    if (control.hasError('pattern')) return 'Enter a valid active workspace user UUID.';
    if (control.hasError('maxlength')) return 'This value is too long.';
    return '';
  }

  private currentFilters(): TaskFilters {
    const value = this.filters.getRawValue();
    const filters: TaskFilters = {
      status: value.status,
      task_type: value.taskType,
      priority: value.priority,
    };
    if (this.leadId()) filters.lead_id = this.leadId()!;
    if (this.view() === 'mine') filters.assigned_to_me = true;
    if (this.view() === 'today') {
      filters.due_today = true;
      filters.timezone = this.timezone;
    }
    if (this.view() === 'overdue') {
      filters.overdue = true;
      filters.timezone = this.timezone;
    }
    return filters;
  }

  private loadActivities(task: LeadTask, page = 1, collected: LeadActivity[] = []): void {
    if (page === 1) this.activitiesLoading.set(true);
    this.leadsService
      .listActivities(task.lead_id, page, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          const contactActivities = data.items.filter(
            (activity) =>
              !activity.is_amendment && CONTACT_ACTIVITY_TYPES.includes(activity.activity_type),
          );
          const allActivities = [...collected, ...contactActivities];
          if (data.page * data.size < data.total) {
            this.loadActivities(task, data.page + 1, allActivities);
            return;
          }
          this.activitiesLoading.set(false);
          this.activities.set(allActivities);
          const selected = this.completionForm.controls.activityId.value;
          if (!selected && allActivities.length) {
            this.completionForm.controls.activityId.setValue(allActivities[0].id);
          } else if (!selected) {
            this.completionForm.controls.mode.setValue('log');
          }
        },
        error: (error: unknown) => {
          this.activitiesLoading.set(false);
          this.completionForm.controls.mode.setValue('log');
          this.errorMessage.set(
            leadErrorDetails(error, 'Unable to load contact activities. You can log a new one.')
              .message,
          );
        },
      });
  }

  private loadUsers(page = 1): void {
    this.settings
      .listUsers(page, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.users.update((users) => [
            ...users,
            ...data.items.filter(
              (candidate) => candidate.is_active && !users.some((user) => user.id === candidate.id),
            ),
          ]);
          if (data.page * data.size < data.total) this.loadUsers(data.page + 1);
        },
      });
  }

  private runMutation(
    operation: ReturnType<TasksService['cancel']>,
    fallback: string,
    onSuccess: () => void,
  ): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.clearMutationErrors();
    operation
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ message }) => {
          onSuccess();
          this.notice.set(message || 'Task saved.');
          this.load(1);
        },
        error: (error: unknown) => {
          const details = leadErrorDetails(error, fallback);
          this.errorMessage.set(details.message);
          this.fieldErrors.set(details.fieldErrors);
          if (details.stale) {
            this.editorOpen.set(false);
            this.editorTask.set(null);
            this.completionTask.set(null);
            this.cancelCandidate.set(null);
            this.load(this.page());
          }
        },
      });
  }

  private clearMutationErrors(): void {
    this.errorMessage.set('');
    this.fieldErrors.set({});
  }
}
