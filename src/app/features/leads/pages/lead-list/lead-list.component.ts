import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Subject,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';

import { PERMISSIONS } from '../../../../core/models/auth.models';
import { SettingsUser } from '../../../../core/models/settings.models';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { COUNTRY_OPTIONS, catalogLabel, countryName } from '../../models/lead-catalogs';
import {
  EMAIL_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  Lead,
  LeadEmailSummary,
  LeadFilters,
  LeadSmsSummary,
  LeadServiceOption,
} from '../../models/lead.models';
import { leadErrorDetails } from '../../services/lead-errors';
import { LeadsService } from '../../services/leads.service';
import { BulkSendEmailComponent } from '../../../mail/bulk-send-email/bulk-send-email.component';
import { BulkSelectionMode } from '../../../mail/models/outbound-message.models';
import { SendSmsComponent } from '../../../sms/send-sms/send-sms.component';
import { SMS_DIRECT_SEND_MAX_RECIPIENTS, SmsRecipientInput } from '../../../sms/models/sms.models';

type SortColumn = 'name' | 'company' | 'email' | 'country' | 'status' | 'assignee';

@Component({
  selector: 'app-lead-list',
  imports: [DatePipe, ReactiveFormsModule, RouterLink, BulkSendEmailComponent, SendSmsComponent],
  templateUrl: './lead-list.component.html',
})
export class LeadListComponent {
  @ViewChild(BulkSendEmailComponent) private bulkComposer?: BulkSendEmailComponent;
  @ViewChild(SendSmsComponent) private smsComposer?: SendSmsComponent;
  private readonly leads = inject(LeadsService);
  private readonly settings = inject(SettingsService);
  protected readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly permissions = PERMISSIONS;
  protected readonly items = signal<Lead[]>([]);
  protected readonly loading = signal(false);
  protected readonly mutating = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly notice = signal('');
  protected readonly permissionDenied = signal(false);
  protected readonly archiveCandidate = signal<Lead | null>(null);
  protected readonly page = signal(1);
  protected readonly pageSize = 20;
  protected readonly total = signal(0);
  protected readonly sortColumn = signal<SortColumn>('name');
  protected readonly sortDirection = signal<'asc' | 'desc'>('asc');
  protected readonly assignees = signal<SettingsUser[]>([]);
  protected readonly serviceOptions = signal<LeadServiceOption[]>([]);
  protected readonly serviceOptionsLoading = signal(false);
  protected readonly serviceOptionsError = signal('');
  protected readonly serviceOptionsTotal = signal(0);
  protected readonly selectedLeadIds = signal<ReadonlySet<string>>(new Set());
  protected readonly selectionMode = signal<BulkSelectionMode>('selected');
  protected readonly selectionNotice = signal('');
  protected readonly selectionRevision = signal(0);
  protected readonly composeMode = signal<BulkSelectionMode>('selected');
  protected readonly composeLeadIds = signal<readonly string[]>([]);
  protected readonly composeFilters = signal<Readonly<Record<string, string>>>({});
  protected readonly composeRecipientCount = signal(0);
  protected readonly composeSmsRecipients = signal<readonly SmsRecipientInput[]>([]);
  protected readonly composeSmsRecipientCount = signal(0);
  protected readonly smsBatchLimit = SMS_DIRECT_SEND_MAX_RECIPIENTS;
  protected readonly countryOptions = COUNTRY_OPTIONS;
  protected readonly statuses = LEAD_STATUSES;
  protected readonly emailStatuses = EMAIL_STATUSES;
  protected readonly sources = LEAD_SOURCES;
  protected readonly label = catalogLabel;

  protected readonly filters = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    company: new FormControl('', { nonNullable: true }),
    country: new FormControl('', { nonNullable: true }),
    industry: new FormControl('', { nonNullable: true }),
    serviceRequested: new FormControl('', { nonNullable: true }),
    status: new FormControl('', { nonNullable: true }),
    emailStatus: new FormControl('', { nonNullable: true }),
    source: new FormControl('', { nonNullable: true }),
    assignedUserId: new FormControl('', { nonNullable: true }),
  });
  protected readonly serviceOptionSearch = new FormControl('', { nonNullable: true });

  private readonly refreshList = new Subject<void>();
  private readonly serviceOptionRequests = new Subject<string>();
  private activeFilterKey: string | null = null;
  private readonly selectedLeadSnapshots = new Map<string, Lead>();

  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize)),
  );
  protected readonly sortedItems = computed(() => {
    const column = this.sortColumn();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    const assigneeNames = new Map(this.assignees().map((user) => [user.id, user.display_name]));
    const value = (lead: Lead): string => {
      if (column === 'name') return `${lead.first_name} ${lead.last_name}`;
      if (column === 'assignee')
        return assigneeNames.get(lead.assigned_user_id || '') || lead.assigned_user_id || '';
      if (column === 'country') return countryName(lead.country);
      return String(lead[column] || '');
    };
    return [...this.items()].sort((a, b) => value(a).localeCompare(value(b)) * direction);
  });
  protected readonly selectedCount = computed(() =>
    this.selectionMode() === 'all_matching' ? this.total() : this.selectedLeadIds().size,
  );
  protected readonly selectedOnPageCount = computed(
    () => this.items().filter((lead) => this.selectedLeadIds().has(lead.id)).length,
  );
  protected readonly allPageSelected = computed(
    () =>
      this.items().length > 0 &&
      (this.selectionMode() === 'all_matching' ||
        this.selectedOnPageCount() === this.items().length),
  );
  protected readonly pageSelectionIndeterminate = computed(
    () =>
      this.selectionMode() !== 'all_matching' &&
      this.selectedOnPageCount() > 0 &&
      !this.allPageSelected(),
  );

  constructor() {
    combineLatest([this.route.queryParamMap, this.refreshList.pipe(startWith(undefined))])
      .pipe(
        switchMap(([params]) => {
          const filterKey = JSON.stringify(
            params.keys
              .filter((key) => key !== 'page')
              .sort()
              .map((key) => [key, params.getAll(key)]),
          );
          if (this.activeFilterKey !== null && this.activeFilterKey !== filterKey) {
            this.clearSelection('Selection cleared because filters changed.');
          }
          this.activeFilterKey = filterKey;
          const page = Math.max(1, Number(params.get('page')) || 1);
          this.page.set(page);
          this.filters.patchValue(
            {
              search: params.get('search') || '',
              company: params.get('company') || '',
              country: countryName(params.get('country')),
              industry: params.get('industry') || '',
              serviceRequested: params.get('service_requested') || '',
              status: params.get('status') || '',
              emailStatus: params.get('email_status') || '',
              source: params.get('source') || '',
              assignedUserId: params.get('assigned_user_id') || '',
            },
            { emitEvent: false },
          );
          this.loading.set(true);
          this.errorMessage.set('');
          this.permissionDenied.set(false);
          return this.leads.list(page, this.pageSize, this.currentFilters()).pipe(
            map(({ data }) => ({ data, error: null })),
            catchError((error: unknown) =>
              of({
                data: null,
                error: leadErrorDetails(error, 'Unable to load leads.'),
              }),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ data, error }) => {
        this.loading.set(false);
        if (data) {
          this.items.set(data.items);
          for (const lead of data.items) {
            if (this.selectedLeadIds().has(lead.id)) this.selectedLeadSnapshots.set(lead.id, lead);
          }
          this.page.set(data.page);
          this.total.set(data.total);
        } else if (error) {
          this.permissionDenied.set(error.forbidden);
          this.errorMessage.set(error.message);
        }
      });

    this.serviceOptionRequests
      .pipe(
        switchMap((search) => {
          if (!this.auth.selectedWorkspace()) {
            return of({ items: [], total: 0, error: '' });
          }
          this.serviceOptionsLoading.set(true);
          this.serviceOptionsError.set('');
          return this.leads.listServiceOptions(1, 100, search).pipe(
            map(({ data }) => ({ items: data.items, total: data.total, error: '' })),
            catchError((error: unknown) =>
              of({
                items: [],
                total: 0,
                error: leadErrorDetails(error, 'Unable to load service options.').message,
              }),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ items, total, error }) => {
        this.serviceOptionsLoading.set(false);
        this.serviceOptions.set(items);
        this.serviceOptionsTotal.set(total);
        this.serviceOptionsError.set(error);
      });

    this.filters.controls.search.valueChanges
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());
    this.filters.controls.serviceRequested.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());
    this.serviceOptionSearch.valueChanges
      .pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => this.serviceOptionRequests.next(search));
    this.leads.mutations$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.refreshList.next();
      this.serviceOptionRequests.next(this.serviceOptionSearch.value);
    });

    let previousWorkspaceId: string | null | undefined;
    toObservable(this.auth.selectedWorkspace)
      .pipe(
        map((workspace) => workspace?.id || null),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((workspaceId) => {
        const workspaceChanged =
          previousWorkspaceId !== undefined && previousWorkspaceId !== workspaceId;
        previousWorkspaceId = workspaceId;
        this.serviceOptions.set([]);
        this.serviceOptionsTotal.set(0);
        this.serviceOptionsError.set('');
        if (workspaceChanged) {
          this.serviceOptionSearch.setValue('', { emitEvent: false });
          if (this.filters.controls.serviceRequested.value) {
            this.filters.controls.serviceRequested.setValue('', { emitEvent: false });
            void this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { page: 1, service_requested: null },
              queryParamsHandling: 'merge',
            });
          } else if (workspaceId) {
            this.refreshList.next();
          }
        }
        this.serviceOptionRequests.next(this.serviceOptionSearch.value);
      });
    if (this.auth.hasPermission(PERMISSIONS.settingsUsersView)) this.loadAssignees();
  }

  protected applyFilters(): void {
    this.clearSelection('Selection cleared because filters changed.');
    const value = this.filters.getRawValue();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        page: 1,
        search: value.search.trim() || null,
        company: value.company.trim() || null,
        country: countryName(value.country) || null,
        industry: value.industry.trim() || null,
        service_requested: value.serviceRequested || null,
        status: value.status || null,
        email_status: value.emailStatus || null,
        source: value.source || null,
        assigned_user_id: value.assignedUserId || null,
      },
      queryParamsHandling: 'merge',
    });
  }

  protected clearFilters(): void {
    this.clearSelection('Selection cleared because filters changed.');
    this.filters.reset({}, { emitEvent: false });
    this.serviceOptionSearch.setValue('', { emitEvent: false });
    this.serviceOptionRequests.next('');
    void this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  protected retryServiceOptions(): void {
    this.serviceOptionRequests.next(this.serviceOptionSearch.value);
  }

  protected goToPage(page: number): void {
    if (page < 1 || page > this.pageCount() || page === this.page()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }

  protected togglePageSelection(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (this.selectionMode() === 'all_matching' && !checked) {
      this.clearSelection('All-matching selection cleared.');
      return;
    }
    const next = new Set(this.selectedLeadIds());
    for (const lead of this.items()) {
      if (checked) {
        next.add(lead.id);
        this.selectedLeadSnapshots.set(lead.id, lead);
      } else {
        next.delete(lead.id);
        this.selectedLeadSnapshots.delete(lead.id);
      }
    }
    this.selectionMode.set('selected');
    this.selectedLeadIds.set(next);
    this.selectionNotice.set(
      checked
        ? `${this.items().length} leads on this page selected. Other page selections are preserved.`
        : 'Current page selection cleared. Other page selections are preserved.',
    );
    this.selectionRevision.update((value) => value + 1);
  }

  protected toggleLeadSelection(leadId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (this.selectionMode() === 'all_matching' && !checked) {
      this.clearSelection('All-matching selection cleared because a lead was deselected.');
      return;
    }
    const next = new Set(this.selectedLeadIds());
    if (checked) {
      next.add(leadId);
      const lead = this.items().find((item) => item.id === leadId);
      if (lead) this.selectedLeadSnapshots.set(leadId, lead);
    } else {
      next.delete(leadId);
      this.selectedLeadSnapshots.delete(leadId);
    }
    this.selectionMode.set('selected');
    this.selectedLeadIds.set(next);
    this.selectionNotice.set('');
    this.selectionRevision.update((value) => value + 1);
  }

  protected isLeadSelected(leadId: string): boolean {
    return this.selectionMode() === 'all_matching' || this.selectedLeadIds().has(leadId);
  }

  protected selectAllMatching(): void {
    if (this.total() < 1) return;
    this.selectionMode.set('all_matching');
    this.selectedLeadIds.set(new Set());
    this.selectedLeadSnapshots.clear();
    for (const lead of this.items()) this.selectedLeadSnapshots.set(lead.id, lead);
    this.selectionNotice.set(`All ${this.total()} matching leads are selected across every page.`);
    this.selectionRevision.update((value) => value + 1);
  }

  protected clearSelection(message = 'Selection cleared.'): void {
    if (this.selectedCount() === 0) return;
    this.selectionMode.set('selected');
    this.selectedLeadIds.set(new Set());
    this.selectedLeadSnapshots.clear();
    this.selectionNotice.set(message);
    this.selectionRevision.update((value) => value + 1);
  }

  protected sendSelected(): void {
    if (!this.auth.hasPermission(PERMISSIONS.mailSend) || this.selectedCount() < 1) return;
    this.composeMode.set(this.selectionMode());
    this.composeLeadIds.set([...this.selectedLeadIds()]);
    this.composeFilters.set(this.bulkFilterSnapshot());
    this.composeRecipientCount.set(this.selectedCount());
    this.selectionRevision.update((value) => value + 1);
    setTimeout(() => this.bulkComposer?.openComposer());
  }

  protected sendToLead(lead: Lead): void {
    if (!this.auth.hasPermission(PERMISSIONS.mailSend)) return;
    this.composeMode.set('selected');
    this.composeLeadIds.set([lead.id]);
    this.composeFilters.set({});
    this.composeRecipientCount.set(1);
    this.selectionRevision.update((value) => value + 1);
    setTimeout(() => this.bulkComposer?.openComposer());
  }

  protected sendSelectedSms(): void {
    if (!this.auth.hasPermission(PERMISSIONS.mailSend) || this.selectedCount() < 1) return;
    if (this.selectedCount() > this.smsBatchLimit) {
      this.selectionNotice.set(
        `${this.selectedCount()} leads are selected; SMS supports up to ${this.smsBatchLimit} recipients per send.`,
      );
      return;
    }
    const selected =
      this.selectionMode() === 'all_matching'
        ? this.items().slice(0, this.selectedCount())
        : [...this.selectedLeadIds()]
            .map((id) => this.selectedLeadSnapshots.get(id))
            .filter((lead): lead is Lead => Boolean(lead));
    if (selected.length !== this.selectedCount()) {
      this.selectionNotice.set(
        'The SMS recipients could not be resolved safely. Clear the selection and select the intended leads again.',
      );
      return;
    }
    this.composeSmsRecipients.set(selected.map((lead) => this.smsRecipient(lead)));
    this.composeSmsRecipientCount.set(this.selectedCount());
    setTimeout(() => this.smsComposer?.openComposer());
  }

  protected sendSmsToLead(lead: Lead): void {
    if (!this.auth.hasPermission(PERMISSIONS.mailSend)) return;
    this.composeSmsRecipients.set([this.smsRecipient(lead)]);
    this.composeSmsRecipientCount.set(1);
    setTimeout(() => this.smsComposer?.openComposer());
  }

  protected refreshEmailStatus(): void {
    this.refreshList.next();
  }

  protected refreshSmsStatus(): void {
    this.refreshList.next();
  }

  protected sortBy(column: SortColumn): void {
    if (this.sortColumn() === column)
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  protected ariaSort(column: SortColumn): 'ascending' | 'descending' | 'none' {
    if (this.sortColumn() !== column) return 'none';
    return this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }

  protected assigneeName(id: string | null): string {
    if (!id) return 'Unassigned';
    return this.assignees().find((user) => user.id === id)?.display_name || id;
  }

  protected country(value: string | null | undefined): string {
    return countryName(value) || '—';
  }

  protected lastEmailAt(lead: Lead): string | null {
    const summary = this.emailSummary(lead);
    return summary.last_successful_email_at || summary.sent_at || null;
  }

  protected emailSummary(lead: Lead): LeadEmailSummary {
    return (
      lead.email_summary ?? {
        state: 'not_contacted_by_email',
        stage: null,
        attempt_count: 0,
      }
    );
  }

  protected emailStageLabel(lead: Lead): string {
    const stage = this.emailSummary(lead).stage;
    return stage ? this.label(stage) : '—';
  }

  protected emailStatusLabel(lead: Lead): string {
    const state = this.emailSummary(lead).state;
    if (state === 'not_contacted_by_email') return 'No email history';
    if (state === 'queued') return 'Queued — not sent';
    if (state === 'unknown') return 'Unknown — uncertain outcome';
    return this.label(state);
  }

  protected smsSummary(lead: Lead): LeadSmsSummary {
    return (
      lead.sms_summary ?? {
        contact_type: null,
        provider_status: 'not_contacted_by_sms',
        last_successful_at: null,
      }
    );
  }

  protected smsStatusLabel(lead: Lead): string {
    const status = this.smsSummary(lead).provider_status;
    if (!status || status === 'not_contacted_by_sms') return 'No SMS history';
    if (status === 'accepted') return 'Accepted — not delivered';
    if (status === 'queued') return 'Queued — not delivered';
    if (status === 'unknown') return 'Unknown — uncertain outcome';
    return this.label(status);
  }

  protected smsTypeLabel(lead: Lead): string {
    const type = this.smsSummary(lead).contact_type;
    return type ? this.label(type) : '—';
  }

  private smsRecipient(lead: Lead): SmsRecipientInput {
    return {
      id: lead.id,
      name: `${lead.first_name} ${lead.last_name}`.trim(),
      phone: lead.phone?.trim() || null,
    };
  }

  protected archive(): void {
    const lead = this.archiveCandidate();
    if (!lead || this.mutating()) return;
    this.mutating.set(true);
    this.errorMessage.set('');
    this.leads
      .archive(lead.id, lead.row_version)
      .pipe(
        finalize(() => this.mutating.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ message }) => {
          this.archiveCandidate.set(null);
          this.notice.set(message);
        },
        error: (error: unknown) => {
          this.archiveCandidate.set(null);
          this.errorMessage.set(leadErrorDetails(error, 'Unable to archive the lead.').message);
        },
      });
  }

  private currentFilters(): LeadFilters {
    const value = this.filters.getRawValue();
    return {
      search: value.search,
      company: value.company,
      country: countryName(value.country),
      industry: value.industry,
      service_requested: value.serviceRequested,
      status: value.status as LeadFilters['status'],
      email_status: value.emailStatus as LeadFilters['email_status'],
      source: value.source as LeadFilters['source'],
      assigned_user_id: value.assignedUserId,
    };
  }

  private bulkFilterSnapshot(): Readonly<Record<string, string>> {
    return Object.fromEntries(
      Object.entries(this.currentFilters())
        .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    );
  }

  private loadAssignees(): void {
    this.settings
      .listUsers(1, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => this.assignees.set(data.items.filter((user) => user.is_active)),
      });
  }
}
