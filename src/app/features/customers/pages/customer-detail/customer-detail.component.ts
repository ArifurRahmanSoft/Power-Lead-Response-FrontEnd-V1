import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EMPTY, Observable, expand, finalize, map, reduce } from 'rxjs';

import { CustomerDetail } from '../../models/customer.models';
import { CustomersService } from '../../services/customers.service';
import { catalogLabel } from '../../../leads/models/lead-catalogs';
import { LeadActivity } from '../../../leads/models/lead.models';
import { leadErrorDetails } from '../../../leads/services/lead-errors';
import { LeadsService } from '../../../leads/services/leads.service';
import { PERMISSIONS } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { SendEmailComponent } from '../../../mail/send-email/send-email.component';
import {
  OutboundMessage,
  OutboundMessageStatus,
} from '../../../mail/models/outbound-message.models';
import { OutboundMessagesService } from '../../../mail/services/outbound-messages.service';
import { outboundHistoryErrorMessage } from '../../../mail/outbound-message-errors';
import { emailConsentDenialIssue } from '../../../mail/email-consent';

@Component({
  selector: 'app-customer-detail',
  imports: [DatePipe, RouterLink, SendEmailComponent],
  templateUrl: './customer-detail.component.html',
})
export class CustomerDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly customers = inject(CustomersService);
  private readonly leads = inject(LeadsService);
  private readonly messagesService = inject(OutboundMessagesService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);

  protected readonly permissions = PERMISSIONS;
  protected readonly customer = signal<CustomerDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly permissionDenied = signal(false);
  protected readonly label = catalogLabel;
  protected readonly outboundMessages = signal<OutboundMessage[]>([]);
  protected readonly messageActors = signal<Readonly<Record<string, string>>>({});
  protected readonly messagesLoading = signal(false);
  protected readonly messagesError = signal('');
  protected readonly emailEligibilityIssues = computed(() => {
    const current = this.customer();
    if (!current) return [];
    const issues: string[] = [];
    const consentIssue = emailConsentDenialIssue('Customer', current.communication_consent_status);
    if (consentIssue) issues.push(consentIssue);
    if (current.suppressed_at) issues.push('Customer email communication is suppressed.');
    if (current.channel_restrictions.some((channel) => channel.toLowerCase() === 'email')) {
      issues.push('The customer has an email channel restriction.');
    }
    return issues;
  });
  private readonly customerId = this.route.snapshot.paramMap.get('id') || '';

  constructor() {
    this.load();
  }

  protected load(): void {
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
        next: ({ data }) => {
          this.customer.set(data);
          if (this.auth.hasPermission(PERMISSIONS.mailView)) this.loadOutboundMessages();
        },
        error: (error: unknown) => {
          const details = leadErrorDetails(error, 'Unable to load this customer.');
          this.permissionDenied.set(details.forbidden);
          this.errorMessage.set(details.message);
        },
      });
  }

  protected handleOutboundMessage(message: OutboundMessage): void {
    this.outboundMessages.update((items) =>
      [message, ...items.filter((item) => item.id !== message.id)].sort(
        (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      ),
    );
    const actor = this.auth.user();
    if (actor && !this.messageActors()[message.id]) {
      this.messageActors.update((actors) => ({ ...actors, [message.id]: actor.name }));
    }
  }

  protected retryOutboundMessages(): void {
    if (this.messagesLoading()) return;
    this.loadOutboundMessages();
  }

  protected messageActor(messageId: string): string {
    return this.messageActors()[messageId] || 'Authorized workspace user';
  }

  protected statusLabel(status: OutboundMessageStatus | string): string {
    if (status === 'queued') return 'Queued — not sent';
    if (status === 'sent') return 'Sent';
    if (status === 'unknown') return 'Unknown — uncertain outcome';
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  protected failureReason(message: OutboundMessage): string {
    const reason =
      [...message.events].reverse().find((event) => event.safe_reason)?.safe_reason ||
      message.failure_reason ||
      '';
    if (reason) return reason;
    if (message.status === 'unknown')
      return 'Delivery outcome is uncertain. This message will not be automatically resent.';
    if (message.status === 'failed')
      return 'Delivery failed. This message was not automatically resent.';
    return '';
  }

  private loadOutboundMessages(page = 1, accumulated: OutboundMessage[] = []): void {
    if (page === 1) {
      this.messagesLoading.set(true);
      this.messagesError.set('');
    }
    this.messagesService
      .list(page, 100, { customerId: this.customerId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          const messages = [
            ...new Map([...accumulated, ...data.items].map((item) => [item.id, item])).values(),
          ];
          if (data.page * data.size < data.total) {
            this.loadOutboundMessages(data.page + 1, messages);
          } else {
            this.outboundMessages.set(
              messages.sort(
                (left, right) =>
                  new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
              ),
            );
            this.messagesLoading.set(false);
            this.loadMessageActors();
          }
        },
        error: (error: unknown) => {
          this.messagesLoading.set(false);
          this.messagesError.set(outboundHistoryErrorMessage(error));
        },
      });
  }

  private loadMessageActors(): void {
    const leadIds = [...new Set(this.customer()?.conversions.map((item) => item.lead_id) || [])];
    if (!leadIds.length) return;
    for (const leadId of leadIds) {
      this.loadAllActivities(leadId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (activities) => {
            this.messageActors.update((actors) => {
              const next = { ...actors };
              for (const activity of activities) {
                if (!activity.outbound_message_id) continue;
                next[activity.outbound_message_id] = this.actorName(activity.performed_by);
              }
              return next;
            });
          },
          error: () => undefined,
        });
    }
  }

  private loadAllActivities(leadId: string): Observable<LeadActivity[]> {
    return this.leads.listActivities(leadId, 1, 100).pipe(
      expand(({ data }) =>
        data.page * data.size < data.total
          ? this.leads.listActivities(leadId, data.page + 1, 100)
          : EMPTY,
      ),
      map(({ data }) => data.items),
      reduce((activities, page) => [...activities, ...page], [] as LeadActivity[]),
    );
  }

  private actorName(userId: string | null): string {
    if (!userId) return 'System';
    return this.auth.user()?.id === userId ? this.auth.user()?.name || userId : userId;
  }
}
