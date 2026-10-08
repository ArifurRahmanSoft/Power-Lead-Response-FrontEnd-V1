import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { safeInternalReturnUrl } from '../../core/utils/return-url';

@Component({
  selector: 'app-workspace-selector',
  templateUrl: './workspace-selector.component.html',
  styleUrl: './workspace-selector.component.css',
})
export class WorkspaceSelectorComponent {
  protected readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly selectedId = signal('');
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal('');

  protected select(workspaceId: string): void {
    this.selectedId.set(workspaceId);
  }

  protected continue(): void {
    const workspaceId = this.selectedId();
    if (!workspaceId) {
      this.errorMessage.set('Choose a workspace to continue.');
      return;
    }

    this.errorMessage.set('');
    this.submitting.set(true);
    this.auth
      .selectWorkspace(workspaceId)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => {
          const returnUrl = safeInternalReturnUrl(
            this.route.snapshot.queryParamMap.get('returnUrl'),
          );
          void this.router.navigateByUrl(returnUrl ?? '/overview');
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(
            error.status === 403
              ? 'You are not authorized to use that workspace.'
              : 'Workspace selection failed. Please try again.',
          );
        },
      });
  }

  protected logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
