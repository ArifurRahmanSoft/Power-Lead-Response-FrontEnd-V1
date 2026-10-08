import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { LeadCreateRequest } from '../models/lead.models';
import { LeadsService } from './leads.service';

describe('LeadsService', () => {
  let service: LeadsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [LeadsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(LeadsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends server pagination and supported filters while dropping empty values', () => {
    service
      .list(3, 20, {
        search: ' Jane ',
        company: '',
        country: 'BD',
        service_requested: 'website design',
        status: 'qualified',
        assigned_user_id: 'user-id',
      })
      .subscribe();

    const request = http.expectOne(
      (candidate) =>
        candidate.url === `${API_CONFIG.baseUrl}/leads` &&
        candidate.params.get('page') === '3' &&
        candidate.params.get('size') === '20',
    );
    expect(request.request.params.get('search')).toBe('Jane');
    expect(request.request.params.get('country')).toBe('BD');
    expect(request.request.params.get('service_requested')).toBe('website design');
    expect(request.request.params.get('status')).toBe('qualified');
    expect(request.request.params.get('assigned_user_id')).toBe('user-id');
    expect(request.request.params.has('company')).toBe(false);
    request.flush({ success: true, data: { items: [], page: 3, size: 20, total: 0 } });
  });

  it('loads paginated service options with optional backend search', () => {
    service.listServiceOptions(2, 50, ' web ').subscribe();
    const searched = http.expectOne(
      `${API_CONFIG.baseUrl}/leads/service-requested-options?page=2&size=50&search=web`,
    );
    expect(searched.request.method).toBe('GET');
    searched.flush({
      success: true,
      data: {
        items: [{ label: 'Website Design', value: 'website design' }],
        page: 2,
        size: 50,
        total: 1,
      },
    });

    service.listServiceOptions(1, 100, '   ').subscribe();
    const unsearched = http.expectOne(
      `${API_CONFIG.baseUrl}/leads/service-requested-options?page=1&size=100`,
    );
    expect(unsearched.request.params.has('search')).toBe(false);
    unsearched.flush({
      success: true,
      data: { items: [], page: 1, size: 100, total: 0 },
    });
  });

  it('uses typed create, concurrency-safe update, and archive contracts', () => {
    const mutation = vi.fn();
    service.mutations$.subscribe(mutation);
    const lead: LeadCreateRequest = {
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      email_status: 'unknown',
      consent_status: 'unknown',
    };
    service.create(lead).subscribe();
    const create = http.expectOne(`${API_CONFIG.baseUrl}/leads`);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(lead);
    create.flush({ success: true, data: {} });
    expect(mutation).toHaveBeenCalledTimes(1);

    service.update('lead-id', { row_version: 7, company: 'Updated' }).subscribe();
    const update = http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-id`);
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({ row_version: 7, company: 'Updated' });
    update.flush({ success: true, data: {} });
    expect(mutation).toHaveBeenCalledTimes(2);

    service.archive('lead-id', 8).subscribe();
    const archive = http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-id?row_version=8`);
    expect(archive.request.method).toBe('DELETE');
    archive.flush({ success: true, message: 'Lead archived' });
    expect(mutation).toHaveBeenCalledTimes(3);
  });

  it('uses the backend Excel preview, status, error, and idempotent commit endpoints', () => {
    const mutation = vi.fn();
    service.mutations$.subscribe(mutation);
    const file = new File(['workbook'], 'leads.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    service.previewImport(file, { 'Given Name': 'first_name' }).subscribe();
    const preview = http.expectOne(`${API_CONFIG.baseUrl}/leads/imports/preview`);
    expect(preview.request.method).toBe('POST');
    expect(preview.request.body instanceof FormData).toBe(true);
    const uploaded = (preview.request.body as FormData).get('file') as File;
    expect(uploaded.name).toBe('leads.xlsx');
    expect(uploaded.size).toBe(file.size);
    expect((preview.request.body as FormData).get('mapping')).toBe('{"Given Name":"first_name"}');
    preview.flush({ success: true, data: {} });

    service.getImport('batch-id').subscribe();
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/imports/batch-id`)
      .flush({ success: true, data: {} });

    service.getImportErrors('batch-id', 2, 25).subscribe();
    http
      .expectOne(`${API_CONFIG.baseUrl}/leads/imports/batch-id/errors?page=2&size=25`)
      .flush({ success: true, data: { items: [], page: 2, size: 25, total: 0 } });

    service.commitImport('batch-id').subscribe();
    const commit = http.expectOne(`${API_CONFIG.baseUrl}/leads/imports/batch-id/commit`);
    expect(commit.request.method).toBe('POST');
    expect(commit.request.body).toBeNull();
    commit.flush({ success: true, data: {} });
    expect(mutation).toHaveBeenCalledTimes(1);
  });
});
