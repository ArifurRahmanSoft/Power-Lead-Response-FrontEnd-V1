import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api.config';
import { DataResponse, PageData } from '../../leads/models/lead.models';
import {
  LeadTask,
  LeadTaskCompleteRequest,
  LeadTaskCreateRequest,
  LeadTaskUpdateRequest,
  TaskFilters,
} from '../models/task.models';

@Injectable({ providedIn: 'root' })
export class TasksService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${API_CONFIG.baseUrl}/tasks`;

  list(
    page: number,
    size: number,
    filters: TaskFilters,
  ): Observable<DataResponse<PageData<LeadTask>>> {
    let params = new HttpParams().set('page', page).set('size', size);
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, value);
    }
    return this.http.get<DataResponse<PageData<LeadTask>>>(this.baseUrl, { params });
  }

  create(leadId: string, request: LeadTaskCreateRequest): Observable<DataResponse<LeadTask>> {
    return this.http.post<DataResponse<LeadTask>>(
      `${API_CONFIG.baseUrl}/leads/${leadId}/tasks`,
      request,
    );
  }

  update(taskId: string, request: LeadTaskUpdateRequest): Observable<DataResponse<LeadTask>> {
    return this.http.patch<DataResponse<LeadTask>>(`${this.baseUrl}/${taskId}`, request);
  }

  cancel(taskId: string, rowVersion: number): Observable<DataResponse<LeadTask>> {
    return this.http.post<DataResponse<LeadTask>>(`${this.baseUrl}/${taskId}/cancel`, {
      row_version: rowVersion,
    });
  }

  complete(taskId: string, request: LeadTaskCompleteRequest): Observable<DataResponse<LeadTask>> {
    return this.http.post<DataResponse<LeadTask>>(`${this.baseUrl}/${taskId}/complete`, request);
  }
}
