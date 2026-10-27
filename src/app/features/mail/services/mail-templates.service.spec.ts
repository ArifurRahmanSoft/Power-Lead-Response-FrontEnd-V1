import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { MailTemplateCreateRequest } from '../models/mail-template.models';
import { MailTemplatesService } from './mail-templates.service';

describe('MailTemplatesService', () => {
  let service: MailTemplatesService;
  let http: HttpTestingController;
  const baseUrl = `${API_CONFIG.baseUrl}/mail/templates`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MailTemplatesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uses the configured list contract and backend filter names', () => {
    service
      .list(2, 20, {
        search: 'outreach',
        approvalStatus: 'draft',
        includeArchived: true,
      })
      .subscribe();
    const request = http.expectOne(
      `${baseUrl}?page=2&size=20&search=outreach&approval_status=draft&include_archived=true`,
    );
    expect(request.request.method).toBe('GET');
    request.flush({ success: true, data: { items: [], page: 2, size: 20, total: 0 } });
  });

  it('preserves literal text and placeholders in create payloads', () => {
    const payload: MailTemplateCreateRequest = {
      name: 'Initial Outreach',
      subject: 'Hi {{first_name}}',
      body_html: '<p>Hi Arif and {{first_name}}</p>',
      signature_html: '<p>Regards</p>',
      enabled: true,
    };
    service.create(payload).subscribe();
    const request = http.expectOne(baseUrl);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);
    request.flush({ success: true, data: {} });
  });

  it('uploads multipart assets with backend kind and progress enabled', () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    service.uploadAsset('template-id', 'attachment', file).subscribe();
    const request = http.expectOne(`${baseUrl}/template-id/assets`);
    expect(request.request.method).toBe('POST');
    expect(request.request.reportProgress).toBe(true);
    expect(request.request.body).toBeInstanceOf(FormData);
    expect((request.request.body as FormData).get('kind')).toBe('attachment');
    const uploaded = (request.request.body as FormData).get('file');
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).name).toBe('hello.txt');
    request.flush({ success: true, message: 'uploaded', data: {} });
  });

  it('keeps preview and approval separate and never calls a send endpoint', () => {
    service.preview('template-id', { lead_id: 'lead-id', version: 3 }).subscribe();
    const preview = http.expectOne(`${baseUrl}/template-id/preview`);
    expect(preview.request.method).toBe('POST');
    expect(preview.request.body).toEqual({ lead_id: 'lead-id', version: 3 });
    preview.flush({ success: true, data: {} });

    service.approve('template-id').subscribe();
    const approve = http.expectOne(`${baseUrl}/template-id/approve`);
    expect(approve.request.method).toBe('POST');
    expect(approve.request.body).toEqual({});
    approve.flush({ success: true, data: { version: 3, approval_status: 'approved' } });
  });

  it('patches the current template and accepts the backend-created next draft version', () => {
    let version = 0;
    let status = '';
    service.update('template-id', { body_html: '<p>Revised</p>' }).subscribe(({ data }) => {
      version = data.version;
      status = data.approval_status;
    });
    const request = http.expectOne(`${baseUrl}/template-id`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ body_html: '<p>Revised</p>' });
    request.flush({ success: true, data: { version: 4, approval_status: 'draft' } });
    expect(version).toBe(4);
    expect(status).toBe('draft');
  });

  it('uses authenticated API_CONFIG URLs for private asset content', () => {
    service.assetContent('/api/mail/templates/t/assets/a/content').subscribe();
    const request = http.expectOne(`${API_CONFIG.baseUrl}/mail/templates/t/assets/a/content`);
    expect(request.request.method).toBe('GET');
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['asset']));
  });
});
