import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { PERMISSIONS } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { catalogLabel, countryName } from '../../models/lead-catalogs';
import { LEAD_STATUS_TRANSITIONS, Lead, LeadStatus } from '../../models/lead.models';
import { leadErrorDetails } from '../../services/lead-errors';
import { LeadsService } from '../../services/leads.service';
import { normalizeLeadUrl } from '../../validators/lead-url.validator';

@Component({
  selector: 'app-lead-detail',
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './lead-detail.component.html',
})
export class LeadDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly leads = inject(LeadsService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);

  protected readonly permissions = PERMISSIONS;
  protected readonly lead = signal<Lead | null>(null);
  protected readonly loading = signal(true);
  protected readonly savingStatus = signal(false);
  protected readonly archiving = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly notice = signal(
    this.route.snapshot.queryParamMap.get('saved') ? 'Lead saved successfully.' : '',
  );
  protected readonly permissionDenied = signal(false);
  protected readonly archiveOpen = signal(false);
  protected readonly statusControl = new FormControl<LeadStatus | ''>('', { nonNullable: true });
  protected readonly label = catalogLabel;
  protected readonly nextStatuses = computed(() => {
    const current = this.lead();
    return current ? LEAD_STATUS_TRANSITIONS[current.status] : [];
  });
  private readonly leadId = this.route.snapshot.paramMap.get('id') || '';

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.permissionDenied.set(false);
    this.leads
      .get(this.leadId)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.lead.set(data);
          this.statusControl.setValue('');
        },
        error: (error: unknown) => {
          const details = leadErrorDetails(error, 'Unable to load this lead.');
          this.permissionDenied.set(details.forbidden);
          this.errorMessage.set(details.message);
        },
      });
  }

  protected updateStatus(): void {
    const lead = this.lead();
    const status = this.statusControl.value;
    if (!lead || !status || this.savingStatus()) return;
    this.savingStatus.set(true);
    this.errorMessage.set('');
    this.leads
      .update(lead.id, { row_version: lead.row_version, status })
      .pipe(
        finalize(() => this.savingStatus.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data, message }) => {
          this.lead.set(data);
          this.statusControl.setValue('');
          this.notice.set(message || 'Lead status updated.');
        },
        error: (error: unknown) =>
          this.errorMessage.set(leadErrorDetails(error, 'Unable to update lead status.').message),
      });
  }

  protected archive(): void {
    const lead = this.lead();
    if (!lead || this.archiving()) return;
    this.archiving.set(true);
    this.leads
      .archive(lead.id, lead.row_version)
      .pipe(
        finalize(() => this.archiving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => void this.router.navigate(['/leads']),
        error: (error: unknown) => {
          this.archiveOpen.set(false);
          this.errorMessage.set(leadErrorDetails(error, 'Unable to archive the lead.').message);
        },
      });
  }

  protected externalUrl(url: string | null | undefined): string {
    return normalizeLeadUrl(url) || '';
  }

  protected country(value: string | null | undefined): string {
    return countryName(value);
  }

  protected hasSafeSocial(lead: Lead): boolean {
    return [
      lead.linkedin_url,
      lead.facebook_url,
      lead.instagram_url,
      lead.x_url,
      lead.github_url,
    ].some((url) => Boolean(this.externalUrl(url)));
  }
}
