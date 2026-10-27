import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';

import { PERMISSIONS, PermissionKey } from '../../../../core/models/auth.models';
import {
  ApiDataResponse,
  PaginatedData,
  SettingsUser,
} from '../../../../core/models/settings.models';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { Lead, LeadCreateRequest } from '../../models/lead.models';
import { LeadVoiceFormValues } from '../../models/lead-voice.models';
import { LeadVoiceService } from '../../services/lead-voice.service';
import { LeadsService } from '../../services/leads.service';
import { LeadFormComponent } from './lead-form.component';

const ORIGINAL_ASSIGNEE_ID = '11111111-1111-4111-8111-111111111111';
const NEW_ASSIGNEE_ID = '22222222-2222-4222-8222-222222222222';

function editLead(assignedUserId: string | null = ORIGINAL_ASSIGNEE_ID): Lead {
  return {
    id: 'lead-id',
    tracking_id: 'PL-1',
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@example.com',
    country: 'Bangladesh',
    company: 'Acme',
    company_website: 'https://example.com',
    service_requested: 'SEO',
    email_status: 'unknown',
    consent_status: 'unknown',
    source: 'manual',
    status: 'new',
    priority: 'normal',
    assigned_user_id: assignedUserId,
    import_batch_id: null,
    created_at: '2026-10-05T00:00:00Z',
    created_by: 'user-id',
    updated_at: '2026-10-05T00:00:00Z',
    updated_by: 'user-id',
    row_version: 4,
  };
}

function settingsUser(id: string, displayName: string): SettingsUser {
  return {
    id,
    membership_id: `membership-${id}`,
    display_name: displayName,
    email: `${displayName.toLowerCase()}@example.com`,
    login_id: `${displayName.toLowerCase()}-login`,
    role_id: 'role-id',
    role_name: 'Sales',
    is_active: true,
  };
}

function userPage(users: SettingsUser[]): ApiDataResponse<PaginatedData<SettingsUser>> {
  return {
    success: true,
    data: { items: users, page: 1, size: 100, total: users.length },
  };
}

describe('LeadFormComponent backend contract', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LeadFormComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { hasPermission: () => false } },
        { provide: SettingsService, useValue: {} },
        { provide: LeadsService, useValue: {} },
        { provide: LeadVoiceService, useValue: { extract: vi.fn() } },
      ],
    });
  });

  it('shows Fill by Voice to a view-only user while disabling and guarding Create', () => {
    const hasPermission = vi.fn(
      (permission: PermissionKey) => permission === PERMISSIONS.leadsView,
    );
    const create = vi.fn();
    TestBed.overrideProvider(AuthService, { useValue: { hasPermission } });
    TestBed.overrideProvider(LeadsService, { useValue: { create } });
    const fixture = TestBed.createComponent(LeadFormComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as { submit(): void };
    const submitButton = fixture.debugElement.query(By.css('button[type="submit"]'))
      .nativeElement as HTMLButtonElement;

    expect(fixture.debugElement.query(By.css('app-lead-voice-input'))).not.toBeNull();
    expect(submitButton.disabled).toBe(true);
    expect(
      fixture.debugElement.query(By.css('.save-permission-note')).nativeElement.textContent,
    ).toContain('does not have permission to create leads');
    component.submit();
    expect(create).not.toHaveBeenCalled();
    expect(hasPermission).toHaveBeenCalledWith(PERMISSIONS.leadsView);
    expect(hasPermission).toHaveBeenCalledWith(PERMISSIONS.leadsCreate);
  });

  it('shows Fill by Voice and enables Create for a create-enabled Lead menu user', () => {
    const hasPermission = vi.fn(
      (permission: PermissionKey) =>
        permission === PERMISSIONS.leadsView || permission === PERMISSIONS.leadsCreate,
    );
    TestBed.overrideProvider(AuthService, { useValue: { hasPermission } });
    const fixture = TestBed.createComponent(LeadFormComponent);
    fixture.detectChanges();
    const submitButton = fixture.debugElement.query(By.css('button[type="submit"]'))
      .nativeElement as HTMLButtonElement;

    expect(fixture.debugElement.query(By.css('app-lead-voice-input'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('.save-permission-note'))).toBeNull();
    expect(submitButton.disabled).toBe(false);
  });

  it('builds a create payload with bare URLs, country names, optional blanks, and service requested', () => {
    const fixture = TestBed.createComponent(LeadFormComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      form: {
        patchValue(value: Record<string, string>): void;
        valid: boolean;
      };
      toDto(): LeadCreateRequest;
    };

    component.form.patchValue({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'JANE@example.com',
      country: 'Bangladesh',
      companyWebsite: 'google.com',
      linkedinUrl: 'https://linkedin.com/in/jane',
      serviceRequested: 'Website Design',
      facebookUrl: '',
    });

    expect(component.form.valid).toBe(true);
    expect(component.toDto()).toMatchObject({
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      country: 'Bangladesh',
      company_website: 'google.com',
      linkedin_url: 'https://linkedin.com/in/jane',
      facebook_url: null,
      service_requested: 'Website Design',
    });
  });

  it('shows older API country codes as names when editing', () => {
    const fixture = TestBed.createComponent(LeadFormComponent);
    const lead = {
      id: 'lead-id',
      tracking_id: 'PL-1',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      country: 'BD',
      company_website: 'https://google.com/path',
      service_requested: 'SEO',
      email_status: 'unknown',
      consent_status: 'unknown',
      source: 'manual',
      status: 'new',
      priority: 'normal',
      assigned_user_id: null,
      import_batch_id: null,
      created_at: '2026-10-05T00:00:00Z',
      created_by: 'user-id',
      updated_at: '2026-10-05T00:00:00Z',
      updated_by: 'user-id',
      row_version: 1,
    } satisfies Lead;

    fixture.componentRef.setInput('lead', lead);
    fixture.detectChanges();
    const form = (
      fixture.componentInstance as unknown as {
        form: { getRawValue(): Record<string, unknown> };
      }
    ).form.getRawValue();

    expect(form['country']).toBe('Bangladesh');
    expect(form['companyWebsite']).toBe('https://google.com/path');
    expect(form['serviceRequested']).toBe('SEO');
  });

  it('omits assignment fields when the assignee is unchanged', () => {
    const lead = editLead();
    const update = vi.fn().mockReturnValue(of({ success: true, data: lead }));
    const hasPermission = (permission: PermissionKey) =>
      ([
        PERMISSIONS.leadsView,
        PERMISSIONS.leadsUpdate,
        PERMISSIONS.leadsAssign,
        PERMISSIONS.settingsUsersView,
      ] as PermissionKey[]).includes(permission);
    TestBed.overrideProvider(AuthService, { useValue: { hasPermission } });
    TestBed.overrideProvider(SettingsService, {
      useValue: {
        listUsers: vi
          .fn()
          .mockReturnValue(of(userPage([settingsUser(ORIGINAL_ASSIGNEE_ID, 'Original')]))),
      },
    });
    TestBed.overrideProvider(LeadsService, { useValue: { update } });
    const fixture = TestBed.createComponent(LeadFormComponent);
    fixture.componentRef.setInput('lead', lead);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as { submit(): void };

    component.submit();

    const payload = update.mock.calls[0][1] as Record<string, unknown>;
    expect(payload['company']).toBe('Acme');
    expect(payload['row_version']).toBe(4);
    expect(payload).not.toHaveProperty('assigned_user_id');
    expect(payload).not.toHaveProperty('assignment_reason');
    expect(payload).not.toHaveProperty('pending_task_disposition');
    expect(fixture.debugElement.query(By.css('[formControlName="assignmentReason"]'))).toBeNull();
  });

  it('requires and sends a reason and pending-task choice for reassignment', () => {
    const lead = editLead();
    const update = vi.fn().mockReturnValue(of({ success: true, data: lead }));
    TestBed.overrideProvider(AuthService, {
      useValue: {
        hasPermission: (permission: PermissionKey) =>
          ([
            PERMISSIONS.leadsUpdate,
            PERMISSIONS.leadsAssign,
            PERMISSIONS.settingsUsersView,
          ] as PermissionKey[]).includes(permission),
      },
    });
    TestBed.overrideProvider(SettingsService, {
      useValue: {
        listUsers: vi.fn().mockReturnValue(
          of(
            userPage([
              settingsUser(ORIGINAL_ASSIGNEE_ID, 'Original'),
              settingsUser(NEW_ASSIGNEE_ID, 'Replacement'),
            ]),
          ),
        ),
      },
    });
    TestBed.overrideProvider(LeadsService, { useValue: { update } });
    const fixture = TestBed.createComponent(LeadFormComponent);
    fixture.componentRef.setInput('lead', lead);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      form: { patchValue(value: Record<string, string>): void };
      submit(): void;
    };

    component.form.patchValue({ assignedUserId: NEW_ASSIGNEE_ID });
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[formControlName="assignmentReason"]'))).not.toBeNull();
    component.submit();
    fixture.detectChanges();
    expect(update).not.toHaveBeenCalled();
    expect(
      fixture.debugElement.query(By.css('[formControlName="assignmentReason"] + .field-help')),
    ).not.toBeNull();

    component.form.patchValue({
      assignmentReason: 'Territory ownership changed',
      pendingTaskDisposition: 'cancel',
    });
    component.submit();

    expect(update.mock.calls[0][1]).toMatchObject({
      assigned_user_id: NEW_ASSIGNEE_ID,
      assignment_reason: 'Territory ownership changed',
      pending_task_disposition: 'cancel',
      row_version: 4,
    });
  });

  it('treats explicitly clearing an assignee as an assignment change', () => {
    const lead = editLead();
    const update = vi.fn().mockReturnValue(of({ success: true, data: lead }));
    TestBed.overrideProvider(AuthService, {
      useValue: {
        hasPermission: (permission: PermissionKey) =>
          ([
            PERMISSIONS.leadsUpdate,
            PERMISSIONS.leadsAssign,
            PERMISSIONS.settingsUsersView,
          ] as PermissionKey[]).includes(permission),
      },
    });
    TestBed.overrideProvider(SettingsService, {
      useValue: {
        listUsers: vi
          .fn()
          .mockReturnValue(of(userPage([settingsUser(ORIGINAL_ASSIGNEE_ID, 'Original')]))),
      },
    });
    TestBed.overrideProvider(LeadsService, { useValue: { update } });
    const fixture = TestBed.createComponent(LeadFormComponent);
    fixture.componentRef.setInput('lead', lead);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      form: { patchValue(value: Record<string, string>): void };
      submit(): void;
    };

    component.form.patchValue({
      assignedUserId: '',
      assignmentReason: 'Returning to the unassigned queue',
      pendingTaskDisposition: 'retain',
    });
    component.submit();

    expect(update.mock.calls[0][1]).toMatchObject({
      assigned_user_id: null,
      assignment_reason: 'Returning to the unassigned queue',
      pending_task_disposition: 'retain',
    });
  });

  it('shows backend assignment field errors next to the reason input', () => {
    const lead = editLead();
    const update = vi.fn().mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: {
              detail: [
                {
                  loc: ['body', 'assignment_reason'],
                  msg: 'Use a more specific reason.',
                },
              ],
            },
          }),
      ),
    );
    TestBed.overrideProvider(AuthService, {
      useValue: {
        hasPermission: (permission: PermissionKey) =>
          ([PERMISSIONS.leadsUpdate, PERMISSIONS.leadsAssign] as PermissionKey[]).includes(
            permission,
          ),
      },
    });
    TestBed.overrideProvider(LeadsService, { useValue: { update } });
    const fixture = TestBed.createComponent(LeadFormComponent);
    fixture.componentRef.setInput('lead', lead);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      form: {
        patchValue(value: Record<string, string>): void;
        controls: { assignmentReason: { errors: Record<string, unknown> | null } };
      };
      submit(): void;
    };
    component.form.patchValue({
      assignedUserId: NEW_ASSIGNEE_ID,
      assignmentReason: 'Change',
      pendingTaskDisposition: 'transfer',
    });
    fixture.detectChanges();

    component.submit();
    fixture.detectChanges();

    expect(update).toHaveBeenCalled();
    expect(component.form.controls.assignmentReason.errors).toMatchObject({
      server: 'Use a more specific reason.',
    });
    const reasonInput = fixture.nativeElement.querySelector(
      '[formControlName="assignmentReason"]',
    ) as HTMLTextAreaElement;
    expect(reasonInput.parentElement?.textContent).toContain('Use a more specific reason.');
  });

  it('preserves the saved assignee while delayed options load and explains unresolved values', () => {
    const lead = editLead();
    const users = new Subject<ApiDataResponse<PaginatedData<SettingsUser>>>();
    TestBed.overrideProvider(AuthService, {
      useValue: {
        hasPermission: (permission: PermissionKey) =>
          ([
            PERMISSIONS.leadsUpdate,
            PERMISSIONS.leadsAssign,
            PERMISSIONS.settingsUsersView,
          ] as PermissionKey[]).includes(permission),
      },
    });
    TestBed.overrideProvider(SettingsService, {
      useValue: { listUsers: vi.fn().mockReturnValue(users) },
    });
    const fixture = TestBed.createComponent(LeadFormComponent);
    fixture.componentRef.setInput('lead', lead);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      form: { getRawValue(): Record<string, unknown> };
    };

    expect(component.form.getRawValue()['assignedUserId']).toBe(ORIGINAL_ASSIGNEE_ID);
    expect(fixture.nativeElement.textContent).toContain(
      'The saved assignee will remain selected while the list loads.',
    );

    users.next(userPage([settingsUser(NEW_ASSIGNEE_ID, 'Replacement')]));
    users.complete();
    fixture.detectChanges();

    expect(component.form.getRawValue()['assignedUserId']).toBe(ORIGINAL_ASSIGNEE_ID);
    expect(fixture.nativeElement.textContent).toContain(
      'The saved assignee is not in the eligible-user list.',
    );
  });

  it('preserves nonblank manual values until voice overwrite is explicitly confirmed', () => {
    const fixture = TestBed.createComponent(LeadFormComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      form: {
        patchValue(value: Record<string, string>): void;
        getRawValue(): Record<string, unknown>;
      };
      applyVoiceDraft(draft: LeadVoiceFormValues): void;
      confirmVoiceOverwrite(): void;
      voiceConflicts(): Array<{ field: string }>;
    };
    component.form.patchValue({
      firstName: 'Manual Name',
      email: 'manual@example.com',
    });

    component.applyVoiceDraft({
      first_name: 'Voice Name',
      last_name: 'Doe',
      email: 'voice@example.com',
    });

    expect(component.form.getRawValue()['firstName']).toBe('Manual Name');
    expect(component.form.getRawValue()['lastName']).toBe('');
    expect(component.form.getRawValue()['email']).toBe('manual@example.com');
    expect(component.voiceConflicts().map((conflict) => conflict.field)).toEqual([
      'first_name',
      'email',
    ]);

    component.confirmVoiceOverwrite();
    expect(component.form.getRawValue()['firstName']).toBe('Voice Name');
    expect(component.form.getRawValue()['lastName']).toBe('Doe');
    expect(component.form.getRawValue()['email']).toBe('voice@example.com');
  });

  it('applies only nonblank voice values to blank fields and marks updated controls dirty', () => {
    const fixture = TestBed.createComponent(LeadFormComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      form: {
        patchValue(value: Record<string, string>): void;
        getRawValue(): Record<string, unknown>;
        controls: Record<string, { dirty: boolean }>;
      };
      applyVoiceDraft(draft: LeadVoiceFormValues): void;
      applyVoiceToBlankFields(): void;
    };
    component.form.patchValue({ firstName: 'Keep Me', email: 'keep@example.com' });

    component.applyVoiceDraft({
      first_name: 'Replace Me',
      last_name: 'Applied',
      email: '',
      phone: '01712345678',
    });
    component.applyVoiceToBlankFields();

    const value = component.form.getRawValue();
    expect(value['firstName']).toBe('Keep Me');
    expect(value['email']).toBe('keep@example.com');
    expect(value['lastName']).toBe('Applied');
    expect(value['phone']).toBe('01712345678');
    expect(component.form.controls['lastName'].dirty).toBe(true);
    expect(component.form.controls['phone'].dirty).toBe(true);
  });
});
