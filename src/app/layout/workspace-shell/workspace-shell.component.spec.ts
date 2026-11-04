import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { PERMISSIONS, PermissionKey } from '../../core/models/auth.models';
import { AuthService } from '../../core/services/auth.service';
import { WorkspaceShellComponent } from './workspace-shell.component';

@Component({ template: '' })
class EmptyRouteComponent {}

class FakeAuthService {
  readonly role = signal<'owner'>('owner');
  readonly permissions = signal<readonly PermissionKey[]>(Object.values(PERMISSIONS));
  readonly selectedWorkspace = signal({ id: 'workspace-id', name: 'Main', slug: 'main' });
  readonly workspaces = signal([
    { id: 'workspace-id', name: 'Main', slug: 'main', role: 'owner' as const },
  ]);
  readonly user = signal({
    id: 'user-id',
    login_id: 'owner',
    name: 'Workspace Owner',
    email: 'owner@example.com',
  });

  selectWorkspace() {
    return of(null);
  }

  logout(): void {}
}

describe('WorkspaceShellComponent mobile navigation', () => {
  let fixture: ComponentFixture<WorkspaceShellComponent>;
  let originalBodyOverflow: string;
  let router: Router;

  beforeEach(async () => {
    originalBodyOverflow = document.body.style.overflow;
    document.body.classList.remove('workspace-shell-active');
    setViewportWidth(390);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    await TestBed.configureTestingModule({
      imports: [WorkspaceShellComponent],
      providers: [
        provideRouter([
          { path: 'overview', component: EmptyRouteComponent },
          { path: 'leads', component: EmptyRouteComponent },
          { path: 'workflows', component: EmptyRouteComponent },
          { path: 'audits', component: EmptyRouteComponent },
          { path: 'templates', component: EmptyRouteComponent },
          { path: 'settings', component: EmptyRouteComponent },
          { path: 'login', component: EmptyRouteComponent },
        ]),
        { provide: AuthService, useClass: FakeAuthService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspaceShellComponent);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    expect(document.body.classList.contains('workspace-shell-active')).toBe(false);
    document.body.style.overflow = originalBodyOverflow;
    document.body.classList.remove('workspace-shell-active');
    setViewportWidth(1024);
    vi.restoreAllMocks();
  });

  it('locks document scrolling only while the authenticated shell is active', () => {
    expect(document.body.classList.contains('workspace-shell-active')).toBe(true);
    expect(getElement('.workspace-content')).toBeTruthy();
  });

  it('opens as a modal drawer and locks background scrolling', () => {
    const toggle = getElement<HTMLButtonElement>('.menu-toggle');

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(getElement('.sidebar').classList).toContain('open');
    expect(getElement('.sidebar').getAttribute('role')).toBe('dialog');
    expect(getElement('.sidebar').getAttribute('aria-modal')).toBe('true');
    expect(fixture.nativeElement.querySelector('.mobile-backdrop')).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes on Escape and restores background scrolling', () => {
    getElement<HTMLButtonElement>('.menu-toggle').click();
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(getElement('.sidebar').classList).not.toContain('open');
    expect(fixture.nativeElement.querySelector('.mobile-backdrop')).toBeNull();
    expect(document.body.style.overflow).toBe(originalBodyOverflow);
  });

  it('closes when a navigation link is selected', () => {
    getElement<HTMLButtonElement>('.menu-toggle').click();
    fixture.detectChanges();

    getElement<HTMLAnchorElement>('nav a').click();
    fixture.detectChanges();

    expect(getElement('.sidebar').classList).not.toContain('open');
    expect(document.body.style.overflow).toBe(originalBodyOverflow);
  });

  it('removes the overlay and scroll lock when resized to desktop', () => {
    getElement<HTMLButtonElement>('.menu-toggle').click();
    fixture.detectChanges();

    setViewportWidth(1024);
    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();

    const sidebar = getElement('.sidebar');
    expect(sidebar.classList).not.toContain('open');
    expect(sidebar.getAttribute('role')).toBeNull();
    expect(fixture.nativeElement.querySelector('.mobile-backdrop')).toBeNull();
    expect(document.body.style.overflow).toBe(originalBodyOverflow);
  });

  it('resets the main content container on forward route navigation', async () => {
    await router.navigateByUrl('/overview');
    fixture.detectChanges();
    const content = getElement<HTMLElement>('.workspace-content');
    content.scrollTop = 320;

    await router.navigateByUrl('/leads');
    fixture.detectChanges();

    expect(content.scrollTop).toBe(0);
  });

  it('scrolls anchors inside the main container without moving the document', () => {
    const content = getElement<HTMLElement>('.workspace-content');
    const target = document.createElement('section');
    target.id = 'customer-history';
    content.append(target);
    content.scrollTop = 40;
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
      top: 80,
    } as DOMRect);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      top: 280,
    } as DOMRect);
    const shell = fixture.componentInstance as unknown as {
      scrollToFragment(container: HTMLElement, fragment: string): boolean;
    };

    expect(shell.scrollToFragment(content, 'customer-history')).toBe(true);
    expect(content.scrollTop).toBe(240);
    expect(document.documentElement.scrollTop).toBe(0);
  });

  function getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    return fixture.nativeElement.querySelector(selector) as T;
  }
});

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query === '(max-width: 760px)' ? width <= 760 : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
