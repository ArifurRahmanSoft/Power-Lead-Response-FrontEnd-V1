import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject, tap } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api.config';
import { DataResponse } from '../../leads/models/lead.models';
import {
  CustomerDetail,
  CustomerPage,
  LeadConversionRequest,
  LeadConversionResponse,
} from '../models/customer.models';

@Injectable({ providedIn: 'root' })
export class CustomersService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${API_CONFIG.baseUrl}/customers`;
  private readonly mutations = new Subject<void>();

  readonly mutations$ = this.mutations.asObservable();

  list(page = 1, size = 20, search = ''): Observable<DataResponse<CustomerPage>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<DataResponse<CustomerPage>>(this.baseUrl, { params });
  }

  get(customerId: string): Observable<DataResponse<CustomerDetail>> {
    return this.http.get<DataResponse<CustomerDetail>>(`${this.baseUrl}/${customerId}`);
  }

  convert(leadId: string, request: LeadConversionRequest): Observable<LeadConversionResponse> {
    return this.http
      .post<LeadConversionResponse>(`${API_CONFIG.baseUrl}/leads/${leadId}/convert`, request)
      .pipe(tap(() => this.mutations.next()));
  }
}
