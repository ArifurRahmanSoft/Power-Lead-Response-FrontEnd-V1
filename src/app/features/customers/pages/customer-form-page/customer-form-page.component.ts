import { Component, DestroyRef, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { PendingChangesAware } from '../../../../core/guards/pending-changes.guard';
import { CustomerFormComponent } from '../../components/customer-form/customer-form.component';
import { Customer } from '../../models/customer.models';
import { CustomersService } from '../../services/customers.service';
import { leadErrorDetails } from '../../../leads/services/lead-errors';

@Component({
  selector: 'app-customer-form-page',
  imports: [RouterLink, CustomerFormComponent],
  templateUrl: './customer-form-page.component.html',
})
export class CustomerFormPageComponent implements PendingChangesAware {
  @ViewChild(CustomerFormComponent) private customerForm?: CustomerFormComponent;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly customers = inject(CustomersService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly customer = signal<Customer | null>(null);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly permissionDenied = signal(false);
  protected readonly customerId = this.route.snapshot.paramMap.get('id');
  protected readonly editing = Boolean(this.customerId);

  constructor() {
    if (this.customerId) this.loadCustomer();
  }

  public hasUnsavedChanges(): boolean {
    return this.customerForm?.hasUnsavedChanges() ?? false;
  }

  protected loadCustomer(): void {
    if (!this.customerId) return;
    this.loading.set(true);
    this.errorMessage.set('');
    this.permissionDenied.set(false);
    this.customers
      .get(this.customerId)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => this.customer.set(data),
        error: (error: unknown) => {
          const details = leadErrorDetails(error, 'Unable to load this customer.');
          this.permissionDenied.set(details.forbidden);
          this.errorMessage.set(details.message);
        },
      });
  }

  protected finish(saved: Customer): void {
    void this.router.navigate(['/customers', saved.id], { queryParams: { saved: '1' } });
  }

  protected cancel(): void {
    void this.router.navigate(this.customerId ? ['/customers', this.customerId] : ['/customers']);
  }

  protected sourceLabel(customer: Customer): string {
    if (customer.source_type === 'direct') return 'Direct';
    if (customer.source_type === 'lead') return 'Lead';
    return 'Unknown';
  }
}
