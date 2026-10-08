import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { LeadFormComponent } from '../../components/lead-form/lead-form.component';
import { Lead } from '../../models/lead.models';
import { leadErrorDetails } from '../../services/lead-errors';
import { LeadsService } from '../../services/leads.service';

@Component({
  selector: 'app-lead-form-page',
  imports: [RouterLink, LeadFormComponent],
  templateUrl: './lead-form-page.component.html',
})
export class LeadFormPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly leads = inject(LeadsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly lead = signal<Lead | null>(null);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly leadId = this.route.snapshot.paramMap.get('id');
  protected readonly editing = Boolean(this.leadId);

  constructor() {
    if (this.leadId) this.loadLead();
  }

  protected loadLead(): void {
    if (!this.leadId) return;
    this.loading.set(true);
    this.errorMessage.set('');
    this.leads
      .get(this.leadId)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => this.lead.set(data),
        error: (error: unknown) =>
          this.errorMessage.set(leadErrorDetails(error, 'Unable to load this lead.').message),
      });
  }

  protected finish(saved: Lead): void {
    void this.router.navigate(['/leads', saved.id], { queryParams: { saved: '1' } });
  }

  protected cancel(): void {
    void this.router.navigate(this.leadId ? ['/leads', this.leadId] : ['/leads']);
  }
}
