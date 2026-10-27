import { DatePipe } from '@angular/common';
import { Component, DestroyRef, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { MessengerConversation } from '../../models/messenger.models';

@Component({
  selector: 'app-messenger-conversation-list',
  imports: [DatePipe, ReactiveFormsModule],
  templateUrl: './messenger-conversation-list.component.html',
  styleUrl: './messenger-conversation-list.component.css',
})
export class MessengerConversationListComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  @Input() conversations: readonly MessengerConversation[] = [];
  @Input() selectedId: string | null = null;
  @Input() loading = false;
  @Input() refreshing = false;
  @Input() loadingMore = false;
  @Input() errorMessage = '';
  @Input() hasMore = false;
  @Output() readonly conversationSelected = new EventEmitter<MessengerConversation>();
  @Output() readonly searchChanged = new EventEmitter<string>();
  @Output() readonly loadMore = new EventEmitter<void>();
  @Output() readonly retry = new EventEmitter<void>();

  protected readonly searchControl = new FormControl('', { nonNullable: true });

  ngOnInit(): void {
    this.searchControl.valueChanges
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.searchChanged.emit(value));
  }

  protected linkedLabel(conversation: MessengerConversation): string {
    if (conversation.linked_record?.type === 'customer' || conversation.customer_id)
      return 'Customer';
    if (conversation.linked_record?.type === 'lead' || conversation.lead_id) return 'Lead';
    return 'Unlinked';
  }
}
