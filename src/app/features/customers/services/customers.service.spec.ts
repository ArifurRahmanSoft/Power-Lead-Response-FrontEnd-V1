import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  let service: CustomersService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CustomersService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists scoped customers and gets conversion history', () => {
    service.list(2, 20, 'jane@example.com').subscribe();
    const list = http.expectOne(
      `${API_CONFIG.baseUrl}/customers?page=2&size=20&search=jane@example.com`,
    );
    expect(list.request.method).toBe('GET');
    list.flush({ success: true, data: { items: [], page: 2, size: 20, total: 0 } });

    service.get('customer-1').subscribe();
    const detail = http.expectOne(`${API_CONFIG.baseUrl}/customers/customer-1`);
    expect(detail.request.method).toBe('GET');
    detail.flush({ success: true, data: { conversions: [] } });
  });

  it('posts the minimal conversion contract and announces a customer mutation', () => {
    const mutation = vi.fn();
    service.mutations$.subscribe(mutation);
    service
      .convert('lead-1', {
        row_version: 4,
      })
      .subscribe();

    const request = http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/convert`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ row_version: 4 });
    expect(request.request.url).not.toMatch(/mail|message|send/);
    request.flush({ success: true, message: 'Lead converted to customer', data: {} });
    expect(mutation).toHaveBeenCalledOnce();
  });

  it('creates and updates customers through the finalized customer endpoints', () => {
    const mutation = vi.fn();
    service.mutations$.subscribe(mutation);
    const fields = {
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      communication_consent_status: 'unknown' as const,
    };

    service.create(fields).subscribe();
    const create = http.expectOne(`${API_CONFIG.baseUrl}/customers`);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(fields);
    create.flush({ success: true, message: 'Customer created', data: { id: 'customer-1' } });

    service.update('customer-1', { company: 'Example Co', row_version: 3 }).subscribe();
    const update = http.expectOne(`${API_CONFIG.baseUrl}/customers/customer-1`);
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({ company: 'Example Co', row_version: 3 });
    expect(update.request.url).not.toMatch(/convert|mail|message|send/);
    update.flush({ success: true, message: 'Customer updated', data: { id: 'customer-1' } });

    expect(mutation).toHaveBeenCalledTimes(2);
  });
});
