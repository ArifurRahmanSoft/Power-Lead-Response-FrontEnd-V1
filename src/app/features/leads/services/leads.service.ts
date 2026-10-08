import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, Subject, tap } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api.config';
import {
  ActionResponse,
  DataResponse,
  Lead,
  LeadCreateRequest,
  LeadFilters,
  LeadImportBatch,
  LeadImportRow,
  LeadServiceOption,
  LeadUpdateRequest,
  PageData,
} from '../models/lead.models';

@Injectable({ providedIn: 'root' })
export class LeadsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${API_CONFIG.baseUrl}/leads`;
  private readonly mutations = new Subject<void>();

  readonly mutations$ = this.mutations.asObservable();

  list(page: number, size: number, filters: LeadFilters): Observable<DataResponse<PageData<Lead>>> {
    let params = new HttpParams().set('page', page).set('size', size);
    for (const [key, value] of Object.entries(filters)) {
      const normalized = typeof value === 'string' ? value.trim() : value;
      if (normalized) params = params.set(key, normalized);
    }
    return this.http.get<DataResponse<PageData<Lead>>>(this.baseUrl, { params });
  }

  get(leadId: string): Observable<DataResponse<Lead>> {
    return this.http.get<DataResponse<Lead>>(`${this.baseUrl}/${leadId}`);
  }

  create(request: LeadCreateRequest): Observable<DataResponse<Lead>> {
    return this.http
      .post<DataResponse<Lead>>(this.baseUrl, request)
      .pipe(tap(() => this.mutations.next()));
  }

  update(leadId: string, request: LeadUpdateRequest): Observable<DataResponse<Lead>> {
    return this.http
      .patch<DataResponse<Lead>>(`${this.baseUrl}/${leadId}`, request)
      .pipe(tap(() => this.mutations.next()));
  }

  archive(leadId: string, rowVersion: number): Observable<ActionResponse> {
    return this.http
      .delete<ActionResponse>(`${this.baseUrl}/${leadId}`, {
        params: new HttpParams().set('row_version', rowVersion),
      })
      .pipe(tap(() => this.mutations.next()));
  }

  listServiceOptions(
    page = 1,
    size = 100,
    search = '',
  ): Observable<DataResponse<PageData<LeadServiceOption>>> {
    let params = new HttpParams().set('page', page).set('size', size);
    const normalizedSearch = search.trim();
    if (normalizedSearch) params = params.set('search', normalizedSearch);
    return this.http.get<DataResponse<PageData<LeadServiceOption>>>(
      `${this.baseUrl}/service-requested-options`,
      { params },
    );
  }

  downloadImportTemplate(): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/import-template`, { responseType: 'blob' });
  }

  previewImport(
    file: File,
    mapping: Record<string, string>,
  ): Observable<DataResponse<LeadImportBatch>> {
    const body = new FormData();
    body.append('file', file, file.name);
    if (Object.keys(mapping).length) body.append('mapping', JSON.stringify(mapping));
    return this.http.post<DataResponse<LeadImportBatch>>(`${this.baseUrl}/imports/preview`, body);
  }

  commitImport(batchId: string): Observable<DataResponse<LeadImportBatch>> {
    return this.http
      .post<DataResponse<LeadImportBatch>>(`${this.baseUrl}/imports/${batchId}/commit`, null)
      .pipe(tap(() => this.mutations.next()));
  }

  getImport(batchId: string): Observable<DataResponse<LeadImportBatch>> {
    return this.http.get<DataResponse<LeadImportBatch>>(`${this.baseUrl}/imports/${batchId}`);
  }

  getImportErrors(
    batchId: string,
    page: number,
    size: number,
  ): Observable<DataResponse<PageData<LeadImportRow>>> {
    return this.http.get<DataResponse<PageData<LeadImportRow>>>(
      `${this.baseUrl}/imports/${batchId}/errors`,
      { params: new HttpParams().set('page', page).set('size', size) },
    );
  }
}
