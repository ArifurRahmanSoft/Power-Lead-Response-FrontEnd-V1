import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-onboarding-pending',
  templateUrl: './onboarding-pending.component.html',
  styleUrl: './onboarding-pending.component.css',
})
export class OnboardingPendingComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
