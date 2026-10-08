import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { PERMISSIONS } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { RolesComponent } from './roles.component';

class FakeAuthService {
  hasPermission() {
    return true;
  }
}

class FakeSettingsService {
  createRequest?: { name: string };
  failCreate = false;
  readonly roles = [
    { id: 'owner-id', key: 'owner', name: 'Owner', is_system: true },
    { id: 'sales-id', key: 'custom.sales', name: 'Sales', is_system: false },
  ];

  listRoles() {
    return of({
      success: true,
      data: { items: this.roles, page: 1, size: 10, total: this.roles.length },
    });
  }
  createRole(request: { name: string }) {
    this.createRequest = request;
    return this.failCreate
      ? throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { detail: 'Role name already exists' },
            }),
        )
      : of({ success: true, message: 'Role created', data: this.roles[1] });
  }
  updateRole() {
    return of({ success: true, message: 'Role updated', data: this.roles[1] });
  }
  deleteRole() {
    return of({ success: true, message: 'Role deleted' });
  }
}

describe('RolesComponent', () => {
  let settings: FakeSettingsService;

  beforeEach(async () => {
    settings = new FakeSettingsService();
    await TestBed.configureTestingModule({
      imports: [RolesComponent],
      providers: [
        { provide: SettingsService, useValue: settings },
        { provide: AuthService, useClass: FakeAuthService },
      ],
    }).compileComponents();
  });

  it('marks system roles and disables rename and delete actions', () => {
    const fixture = TestBed.createComponent(RolesComponent);
    fixture.detectChanges();
    const firstRow = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;
    expect(firstRow.textContent).toContain('System role');
    expect([...firstRow.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
  });

  it('creates a trimmed role and surfaces backend conflicts', () => {
    const fixture = TestBed.createComponent(RolesComponent);
    fixture.detectChanges();
    clickButton(fixture.nativeElement, 'Add role');
    fixture.detectChanges();
    setInput(fixture.nativeElement, '#role-name', '  Sales Manager  ');
    fixture.nativeElement.querySelector('.modal form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(settings.createRequest).toEqual({ name: 'Sales Manager' });

    settings.failCreate = true;
    clickButton(fixture.nativeElement, 'Add role');
    fixture.detectChanges();
    setInput(fixture.nativeElement, '#role-name', 'Duplicate');
    fixture.nativeElement.querySelector('.modal form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Role name already exists');
  });
});

function clickButton(root: HTMLElement, text: string): void {
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    item.textContent?.includes(text),
  );
  button?.click();
}

function setInput(root: HTMLElement, selector: string, value: string): void {
  const input = root.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
