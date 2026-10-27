import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';

import { Customer } from '../../models/customer.models';
import { CustomersService } from '../../services/customers.service';
import { leadErrorDetails } from '../../../leads/services/lead-errors';

@Component({
  selector: 'app-customer-list',
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './customer-list.component.html',
})
export class CustomerListComponent {
  private readonly customers = inject(CustomersService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly items = signal<Customer[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly permissionDenied = signal(false);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly pageSize = 20;
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize)),
  );

  constructor() {
    this.route.queryParamMap
      .pipe(
        switchMap((params) => {
          const page = Math.max(1, Number(params.get('page')) || 1);
          const search = params.get('search') || '';
          this.page.set(page);
          this.search.setValue(search, { emitEvent: false });
          this.loading.set(true);
          this.errorMessage.set('');
          this.permissionDenied.set(false);
          return this.customers.list(page, this.pageSize, search).pipe(
            map(({ data }) => ({ data, error: null })),
            catchError((error: unknown) =>
              of({
                data: null,
                error: leadErrorDetails(error, 'Unable to load customers.'),
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

    this.search.valueChanges
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applySearch());
  }

  protected applySearch(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: 1, search: this.search.value.trim() || null },
      queryParamsHandling: 'merge',
    });
  }

  protected clearSearch(): void {
    this.search.setValue('', { emitEvent: false });
    void this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  protected goToPage(page: number): void {
    if (page < 1 || page > this.pageCount() || page === this.page()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }
}
