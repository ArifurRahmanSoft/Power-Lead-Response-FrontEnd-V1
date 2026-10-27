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

  it('posts only the explicit conversion record and announces a customer mutation', () => {
    const mutation = vi.fn();
    service.mutations$.subscribe(mutation);
    service
      .convert('lead-1', {
        row_version: 4,
        purchased_service: 'Website Design',
        reference: 'ORDER-1042',
        reason: 'Signed agreement',
        duplicate_resolution: 'link_existing',
        existing_customer_id: 'customer-1',
        pending_acquisition_task_disposition: 'cancel',
        pending_task_reason: 'Acquisition completed',
      })
      .subscribe();

    const request = http.expectOne(`${API_CONFIG.baseUrl}/leads/lead-1/convert`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.existing_customer_id).toBe('customer-1');
    expect(request.request.url).not.toMatch(/mail|message|send/);
    request.flush({ success: true, message: 'Lead converted to customer', data: {} });
    expect(mutation).toHaveBeenCalledOnce();
  });
});
