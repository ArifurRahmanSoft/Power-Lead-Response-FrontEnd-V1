import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { MessageTemplatesService } from './message-templates.service';

describe('MessageTemplatesService', () => {
  let service: MessageTemplatesService;
  let http: HttpTestingController;
  const baseUrl = `${API_CONFIG.baseUrl}/message-templates`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MessageTemplatesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uses the paginated search contract', () => {
    service.list(2, 20, { search: 'বাংলা follow up', includeArchived: true }).subscribe();
    const request = http.expectOne(
      `${baseUrl}?page=2&size=20&search=%E0%A6%AC%E0%A6%BE%E0%A6%82%E0%A6%B2%E0%A6%BE%20follow%20up&include_archived=true`,
    );
    expect(request.request.method).toBe('GET');
    request.flush({ success: true, data: { items: [], page: 2, size: 20, total: 0 } });
  });

  it('preserves Unicode, line breaks and literal placeholders in writes', () => {
    const body = 'হ্যালো {{first_name}},\nএটি সাধারণ লেখা।';
    service.create({ name: 'বাংলা বার্তা', body }).subscribe();
    const create = http.expectOne(baseUrl);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ name: 'বাংলা বার্তা', body });
    create.flush({ success: true, data: {} });

    service.update('template-1', { name: 'Follow-up', body }).subscribe();
    const update = http.expectOne(`${baseUrl}/template-1`);
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body.body).toBe(body);
    update.flush({ success: true, data: {} });
  });

  it('loads the allowlist, previews without sending and archives with DELETE', () => {
    service.placeholders().subscribe();
    http.expectOne(`${baseUrl}/placeholders`).flush({ success: true, data: [] });

    service.preview('template-1').subscribe();
    const preview = http.expectOne(`${baseUrl}/template-1/preview`);
    expect(preview.request.method).toBe('POST');
    expect(preview.request.body).toEqual({});
    expect(http.match((request) => request.url.includes('/send'))).toHaveLength(0);
    preview.flush({ success: true, data: {} });

    service.archive('template-1').subscribe();
    const archive = http.expectOne(`${baseUrl}/template-1`);
    expect(archive.request.method).toBe('DELETE');
    archive.flush({ success: true, message: 'Message template archived' });
  });
});
