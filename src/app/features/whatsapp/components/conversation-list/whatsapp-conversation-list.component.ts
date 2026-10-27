import { DatePipe } from '@angular/common';
import { Component, DestroyRef, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import {
  WhatsAppChannelOption,
  WhatsAppConversation,
  WhatsAppProvider,
} from '../../models/whatsapp.models';

@Component({
  selector: 'app-whatsapp-conversation-list',
  imports: [DatePipe, ReactiveFormsModule],
  templateUrl: './whatsapp-conversation-list.component.html',
  styleUrl: './whatsapp-conversation-list.component.css',
})
export class WhatsAppConversationListComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  @Input() conversations: readonly WhatsAppConversation[] = [];
  @Input() selectedId: string | null = null;
  @Input() loading = false;
  @Input() refreshing = false;
  @Input() loadingMore = false;
  @Input() errorMessage = '';
  @Input() hasMore = false;
  @Input() channels: readonly WhatsAppChannelOption[] = [];
  @Input() selectedProvider: WhatsAppProvider = 'twilio';
  @Input() canStartMetaChat = false;
  @Output() readonly conversationSelected = new EventEmitter<WhatsAppConversation>();
  @Output() readonly searchChanged = new EventEmitter<string>();
  @Output() readonly loadMore = new EventEmitter<void>();
  @Output() readonly retry = new EventEmitter<void>();
  @Output() readonly providerChanged = new EventEmitter<WhatsAppProvider>();
  @Output() readonly newChat = new EventEmitter<void>();

  protected readonly searchControl = new FormControl('', { nonNullable: true });

  ngOnInit(): void {
    this.searchControl.valueChanges
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.searchChanged.emit(value));
  }

  protected displayName(conversation: WhatsAppConversation): string {
    return conversation.contact_name?.trim() || this.displayAddress(conversation.external_address);
  }

  protected displayAddress(address: string): string {
    return address.replace(/^whatsapp:/i, '');
  }

  protected linkedLabel(conversation: WhatsAppConversation): string {
    if (conversation.customer_id) return 'Customer';
    if (conversation.lead_id) return 'Lead';
    return 'Unlinked';
  }

  protected currentChannel(): WhatsAppChannelOption | undefined {
    return this.channels.find((channel) => channel.provider === this.selectedProvider);
  }

  protected chooseProvider(value: string): void {
    if (value === 'meta' || value === 'twilio') this.providerChanged.emit(value);
  }
}
