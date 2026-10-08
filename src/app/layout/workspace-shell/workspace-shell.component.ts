import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { finalize } from 'rxjs';

import { availableMenuItems } from '../../core/config/menu.config';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-workspace-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './workspace-shell.component.html',
  styleUrl: './workspace-shell.component.css',
})
export class WorkspaceShellComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly switchingWorkspace = signal(false);
  protected readonly workspaceError = signal('');

  protected readonly menuItems = computed(() => {
    const role = this.auth.role();
    return availableMenuItems(role, this.auth.permissions()).map((item) => ({
      ...item,
      label: (role && item.roleLabels?.[role]) || item.label,
    }));
  });

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
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
