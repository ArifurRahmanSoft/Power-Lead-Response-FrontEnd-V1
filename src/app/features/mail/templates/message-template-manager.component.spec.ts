import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';

import { API_CONFIG } from '../../../core/config/api.config';
import { PERMISSIONS, PermissionKey } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import { MessageTemplate } from '../models/message-template.models';
import { MessageTemplateManagerComponent } from './message-template-manager.component';

const baseUrl = `${API_CONFIG.baseUrl}/message-templates`;
const template: MessageTemplate = {
  id: 'template-1',
  tenant_id: 'tenant-1',
  category: 'message',
  name: 'Bangla Follow-up',
  body: 'হ্যালো {{first_name}},\nআপনার কোম্পানি {{company}}।',
  archived: false,
  created_by_user_id: 'user-1',
  updated_by_user_id: 'user-1',
  archived_by_user_id: null,
  created_at: '2026-10-17T04:00:00Z',
  updated_at: '2026-10-17T05:00:00Z',
  archived_at: null,
};

interface ExposedManager {
  editorForm: FormGroup<{
    name: FormControl<string>;
    body: FormControl<string>;
  }>;
  variableSelection: FormControl<string>;
  unknownVariables(): string[];
  bodyCharacterCount(): number;
  hasUnsavedChanges(): boolean;
  openCreate(): void;
  openView(template: MessageTemplate): void;
  openEdit(template: MessageTemplate): void;
  insertVariable(): void;
  save(): void;
  loadPreview(): void;
  archive(template: MessageTemplate): void;
}

describe('MessageTemplateManagerComponent', () => {
  let fixture: ComponentFixture<MessageTemplateManagerComponent>;
  let component: ExposedManager;
  let http: HttpTestingController;
  let permissions: Set<PermissionKey>;

  beforeEach(() => {
    permissions = new Set([PERMISSIONS.mailTemplatesView, PERMISSIONS.mailTemplatesManage]);
    TestBed.configureTestingModule({
      imports: [MessageTemplateManagerComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { hasPermission: (permission: PermissionKey) => permissions.has(permission) },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MessageTemplateManagerComponent);
    component = fixture.componentInstance as unknown as ExposedManager;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  function flushInitial(items: MessageTemplate[] = [template]): void {
    http.expectOne(`${baseUrl}?page=1&size=20`).flush({
      success: true,
      data: { items, page: 1, size: 20, total: items.length },
    });
    http.expectOne(`${baseUrl}/placeholders`).flush({
      success: true,
      data: [
        { key: 'first_name', label: 'Lead first name' },
        { key: 'company', label: 'Company name' },
      ],
    });
    fixture.detectChanges();
  }

  it('lists Name, body snippet and updated date with authorized actions', () => {
    flushInitial();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Bangla Follow-up');
    expect(text).toContain('হ্যালো {{first_name}}');
    expect(text).toContain('View');
    expect(text).toContain('Edit');
    expect(text).toContain('Archive');
  });

  it('inserts an allowlisted variable at the textarea cursor and preserves Unicode', () => {
    flushInitial();
    component.openCreate();
    fixture.detectChanges();
    component.editorForm.patchValue({ name: 'বাংলা বার্তা', body: 'হ্যালো ,\nস্বাগতম' });
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    const cursor = component.editorForm.controls.body.value.indexOf(',');
    textarea.setSelectionRange(cursor, cursor);
    component.variableSelection.setValue('first_name');

    component.insertVariable();
    expect(component.editorForm.controls.body.value).toBe('হ্যালো {{first_name}},\nস্বাগতম');
    expect(component.hasUnsavedChanges()).toBe(true);
    expect(component.unknownVariables()).toEqual([]);

    component.save();
    const request = http.expectOne(baseUrl);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: 'বাংলা বার্তা',
      body: 'হ্যালো {{first_name}},\nস্বাগতম',
    });
    request.flush({ success: true, message: 'Message template created', data: template });
    http.expectOne(`${baseUrl}?page=1&size=20`).flush({
      success: true,
      data: { items: [template], page: 1, size: 20, total: 1 },
    });
  });

  it('shows validation and prevents unknown variables from reaching the backend', () => {
    flushInitial([]);
    component.openCreate();
    component.editorForm.patchValue({ name: 'Unknown', body: 'Hi {{not_allowed}}' });
    component.editorForm.markAllAsTouched();
    fixture.detectChanges();

    expect(component.unknownVariables()).toEqual(['not_allowed']);
    expect(fixture.nativeElement.textContent).toContain('Unknown variable: not_allowed');
    component.save();
    http.expectNone(baseUrl);
  });

  it('renders backend preview as plain text and never calls a send endpoint', () => {
    flushInitial();
    component.openView(template);
    fixture.detectChanges();
    component.loadPreview();
    const request = http.expectOne(`${baseUrl}/template-1/preview`);
    expect(request.request.body).toEqual({});
    request.flush({
      success: true,
      data: {
        template_id: 'template-1',
        rendered_body: '<script>alert(1)</script>\nহ্যালো আরিফ',
        missing_values: [],
        warnings: ['No message was sent'],
      },
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.preview-section script')).toBeNull();
    expect(fixture.nativeElement.querySelector('pre').textContent).toContain(
      '<script>alert(1)</script>',
    );
    expect(http.match((candidate) => candidate.url.includes('/send'))).toHaveLength(0);
  });

  it('archives only after explicit confirmation', () => {
    flushInitial();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.archive(template);
    const request = http.expectOne(`${baseUrl}/template-1`);
    expect(request.request.method).toBe('DELETE');
    request.flush({ success: true, message: 'Message template archived' });
    http.expectOne(`${baseUrl}?page=1&size=20`).flush({
      success: true,
      data: { items: [], page: 1, size: 20, total: 0 },
    });
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });
});
