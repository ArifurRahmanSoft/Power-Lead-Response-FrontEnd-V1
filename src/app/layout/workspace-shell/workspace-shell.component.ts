import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { finalize } from 'rxjs';

import { availableMenuItems } from '../../core/config/menu.config';
import { AuthService } from '../../core/services/auth.service';

const MOBILE_MEDIA_QUERY = '(max-width: 760px)';
const FOCUSABLE_ELEMENTS =
  'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

@Component({
  selector: 'app-workspace-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './workspace-shell.component.html',
  styleUrl: './workspace-shell.component.css',
})
export class WorkspaceShellComponent implements OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  @ViewChild('mobileMenuToggle') private mobileMenuToggle?: ElementRef<HTMLButtonElement>;
  @ViewChild('mobileDrawer') private mobileDrawer?: ElementRef<HTMLElement>;
  @ViewChild('drawerClose') private drawerClose?: ElementRef<HTMLButtonElement>;

  protected readonly switchingWorkspace = signal(false);
  protected readonly workspaceError = signal('');
  protected readonly mobileMenuOpen = signal(false);
  protected readonly isMobileViewport = signal(
    this.isBrowser && window.matchMedia(MOBILE_MEDIA_QUERY).matches,
  );
  private previousBodyOverflow = '';
  private bodyScrollLocked = false;

  protected readonly menuItems = computed(() => {
    const role = this.auth.role();
    return availableMenuItems(role, this.auth.permissions()).map((item) => ({
      ...item,
      label: (role && item.roleLabels?.[role]) || item.label,
    }));
  });

  ngOnDestroy(): void {
    this.unlockBodyScroll();
  }

  @HostListener('window:resize')
  protected onWindowResize(): void {
    this.updateViewportState();
  }

  @HostListener('document:keydown', ['$event'])
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.mobileMenuOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMobileMenu();
      return;
    }

    if (event.key === 'Tab') this.trapFocus(event);
  }

  protected openMobileMenu(): void {
    if (!this.isMobileViewport() || this.mobileMenuOpen()) return;

    this.mobileMenuOpen.set(true);
    this.lockBodyScroll();
    this.deferFocus(() => this.drawerClose?.nativeElement.focus());
  }

  protected closeMobileMenu(restoreFocus = true): void {
    if (!this.mobileMenuOpen()) return;

    this.mobileMenuOpen.set(false);
    this.unlockBodyScroll();
    if (restoreFocus) this.deferFocus(() => this.mobileMenuToggle?.nativeElement.focus());
  }

  protected onNavigationSelected(): void {
    this.closeMobileMenu();
  }

  protected switchWorkspace(event: Event): void {
    const workspaceId = (event.target as HTMLSelectElement).value;
    if (!workspaceId || workspaceId === this.auth.selectedWorkspace()?.id) return;

    this.workspaceError.set('');
    this.switchingWorkspace.set(true);
    this.auth
      .selectWorkspace(workspaceId)
      .pipe(finalize(() => this.switchingWorkspace.set(false)))
      .subscribe({
        next: () => void this.router.navigate(['/overview']),
        error: () => this.workspaceError.set('You no longer have access to that workspace.'),
      });
  }

  protected logout(): void {
    this.closeMobileMenu(false);
    this.auth.logout();
    void this.router.navigate(['/login']);
  }

  private updateViewportState(): void {
    if (!this.isBrowser) return;

    const isMobile = window.matchMedia(MOBILE_MEDIA_QUERY).matches;
    this.isMobileViewport.set(isMobile);
    if (!isMobile && this.mobileMenuOpen()) this.closeMobileMenu(false);
  }

  private trapFocus(event: KeyboardEvent): void {
    const drawer = this.mobileDrawer?.nativeElement;
    if (!drawer) return;

    const focusableElements = Array.from(
      drawer.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS),
    ).filter(
      (element) =>
        !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
    );
    if (focusableElements.length === 0) {
      event.preventDefault();
      drawer.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = this.document.activeElement;

    if (event.shiftKey && (activeElement === firstElement || !drawer.contains(activeElement))) {
      event.preventDefault();
      lastElement.focus();
    } else if (
      !event.shiftKey &&
      (activeElement === lastElement || !drawer.contains(activeElement))
    ) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  private lockBodyScroll(): void {
    if (this.bodyScrollLocked) return;
    this.previousBodyOverflow = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';
    this.bodyScrollLocked = true;
  }

  private unlockBodyScroll(): void {
    if (!this.bodyScrollLocked) return;
    this.document.body.style.overflow = this.previousBodyOverflow;
    this.bodyScrollLocked = false;
  }

  private deferFocus(callback: () => void): void {
    if (!this.isBrowser) return;
    window.requestAnimationFrame(callback);
  }
}
