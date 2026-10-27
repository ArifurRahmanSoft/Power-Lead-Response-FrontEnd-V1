import { LeadActivityCreateRequest } from '../../leads/models/lead.models';

export const LEAD_TASK_TYPES = ['contact', 'follow_up', 'review', 'other'] as const;
export const LEAD_TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const LEAD_TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

export type LeadTaskType = (typeof LEAD_TASK_TYPES)[number];
export type LeadTaskPriority = (typeof LEAD_TASK_PRIORITIES)[number];
export type LeadTaskStatus = (typeof LEAD_TASK_STATUSES)[number];
export type TaskView = 'lead' | 'mine' | 'today' | 'overdue';

export interface LeadTask {
  id: string;
  lead_id: string;
  assigned_user_id: string;
  task_type: LeadTaskType;
  title: string;
  notes: string | null;
  due_at: string;
  priority: LeadTaskPriority;
  status: LeadTaskStatus;
  related_activity_id: string | null;
  completed_by: string | null;
  completed_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  row_version: number;
}

export interface LeadTaskCreateRequest {
  assigned_user_id: string;
  task_type: LeadTaskType;
  title: string;
  notes: string | null;
  due_at: string;
  priority: LeadTaskPriority;
  related_activity_id?: string | null;
}

export interface LeadTaskUpdateRequest extends Partial<LeadTaskCreateRequest> {
  row_version: number;
  status?: 'pending' | 'in_progress';
}

export interface LeadTaskCompleteRequest {
  row_version: number;
  related_activity_id?: string | null;
  activity?: LeadActivityCreateRequest | null;
}

export interface TaskFilters {
  lead_id?: string;
  assigned_to_me?: boolean;
  due_today?: boolean;
  overdue?: boolean;
  timezone?: string;
  status?: LeadTaskStatus | '';
  task_type?: LeadTaskType | '';
  priority?: LeadTaskPriority | '';
}
