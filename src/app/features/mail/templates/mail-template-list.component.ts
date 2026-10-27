import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';

import { PERMISSIONS } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import { PendingChangesAware } from '../../../core/guards/pending-changes.guard';
import { MailTemplateApprovalStatus, MailTemplateListItem } from '../models/mail-template.models';
import { mailTemplateErrorDetails } from '../mail-template-errors';
import { MailTemplatesService } from '../services/mail-templates.service';
import { MailTemplatePreviewComponent } from './mail-template-preview.component';
import { MessageTemplateManagerComponent } from './message-template-manager.component';

@Component({
  selector: 'app-mail-template-list',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    MailTemplatePreviewComponent,
    MessageTemplateManagerComponent,
  ],
  templateUrl: './mail-template-list.component.html',
  styleUrl: './mail-template-list.component.css',
})
export class MailTemplateListComponent implements PendingChangesAware {
  @ViewChild(MessageTemplateManagerComponent)
  private messageTemplates?: MessageTemplateManagerComponent;
  private readonly templates = inject(MailTemplatesService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  protected readonly permissions = PERMISSIONS;
  protected readonly activeTab = signal<'email' | 'message'>('email');

  protected readonly items = signal<MailTemplateListItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly busyId = signal<string | null>(null);
  protected readonly errorMessage = signal('');
  protected readonly notice = signal('');
  protected readonly previewing = signal<MailTemplateListItem | null>(null);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly pageSize = 20;
  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize)),
  );

  protected readonly filters = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    status: new FormControl<MailTemplateApprovalStatus | ''>('', { nonNullable: true }),
    includeArchived: new FormControl(false, { nonNullable: true }),
  });
  private readonly refresh = new Subject<void>();

  constructor() {
    this.refresh
      .pipe(
        startWith(undefined),
        switchMap(() => {
          this.loading.set(true);
          this.errorMessage.set('');
          const value = this.filters.getRawValue();
          return this.templates
            .list(this.page(), this.pageSize, {
              search: value.search,
              approvalStatus: value.status || undefined,
              includeArchived: value.includeArchived,
            })
            .pipe(
              map(({ data }) => ({ data, error: '' })),
              catchError((error) =>
                of({
                  data: null,
                  error: mailTemplateErrorDetails(error, 'Unable to load mail templates.').message,
                }),
              ),
              finalize(() => this.loading.set(false)),
            );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ data, error }) => {
        if (data) {
          this.items.set(data.items);
          this.page.set(data.page);
          this.total.set(data.total);
        } else this.errorMessage.set(error);
      });

    this.filters.controls.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());
    this.filters.controls.status.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());
    this.filters.controls.includeArchived.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());
  }

  public hasUnsavedChanges(): boolean {
    return this.messageTemplates?.hasUnsavedChanges() ?? false;
  }

  protected selectTab(tab: 'email' | 'message'): void {
    if (tab === this.activeTab()) return;
    if (
      this.hasUnsavedChanges() &&
      typeof window !== 'undefined' &&
      !window.confirm('Discard unsaved message template changes?')
    )
      return;
    this.activeTab.set(tab);
  }

  protected newMessageTemplate(): void {
    this.messageTemplates?.openCreate();
  }

  protected applyFilters(): void {
    this.page.set(1);
    this.refresh.next();
  }

  protected clearFilters(): void {
    this.filters.reset({ search: '', status: '', includeArchived: false }, { emitEvent: false });
    this.applyFilters();
  }

  protected goToPage(page: number): void {
    if (page < 1 || page > this.pageCount() || page === this.page()) return;
    this.page.set(page);
    this.refresh.next();
  }

  protected approve(item: MailTemplateListItem): void {
    this.busyId.set(item.id);
    this.errorMessage.set('');
    this.notice.set('');
    this.templates
      .approve(item.id)
      .pipe(finalize(() => this.busyId.set(null)))
      .subscribe({
        next: () => {
          this.notice.set(`“${item.name}” version ${item.version} is approved.`);
          this.refresh.next();
        },
        error: (error) =>
          this.errorMessage.set(
            mailTemplateErrorDetails(error, 'Unable to approve the template.').message,
          ),
      });
  }

  protected archive(item: MailTemplateListItem): void {
    if (!window.confirm(`Archive “${item.name}”? Historical versions will be preserved.`)) return;
    this.busyId.set(item.id);
    this.errorMessage.set('');
    this.notice.set('');
    this.templates
      .archive(item.id)
      .pipe(finalize(() => this.busyId.set(null)))
      .subscribe({
        next: () => {
          this.notice.set(`“${item.name}” was archived.`);
          this.refresh.next();
        },
        error: (error) =>
          this.errorMessage.set(
            mailTemplateErrorDetails(error, 'Unable to archive the template.').message,
          ),
      });
  }
}
