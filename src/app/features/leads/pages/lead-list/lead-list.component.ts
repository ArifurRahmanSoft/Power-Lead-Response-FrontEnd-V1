import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
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
  LeadFilters,
  LeadServiceOption,
} from '../../models/lead.models';
import { leadErrorDetails } from '../../services/lead-errors';
import { LeadsService } from '../../services/leads.service';

type SortColumn = 'tracking_id' | 'name' | 'company' | 'email' | 'country' | 'status' | 'assignee';

@Component({
  selector: 'app-lead-list',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './lead-list.component.html',
})
export class LeadListComponent {
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
  protected readonly sortColumn = signal<SortColumn>('tracking_id');
  protected readonly sortDirection = signal<'asc' | 'desc'>('asc');
  protected readonly assignees = signal<SettingsUser[]>([]);
  protected readonly serviceOptions = signal<LeadServiceOption[]>([]);
  protected readonly serviceOptionsLoading = signal(false);
  protected readonly serviceOptionsError = signal('');
  protected readonly serviceOptionsTotal = signal(0);
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

  constructor() {
    combineLatest([this.route.queryParamMap, this.refreshList.pipe(startWith(undefined))])
      .pipe(
        switchMap(([params]) => {
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
    this.leads.mutations$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.serviceOptionRequests.next(this.serviceOptionSearch.value));

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
          this.refreshList.next();
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

  private loadAssignees(): void {
    this.settings
      .listUsers(1, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => this.assignees.set(data.items.filter((user) => user.is_active)),
      });
  }
}
