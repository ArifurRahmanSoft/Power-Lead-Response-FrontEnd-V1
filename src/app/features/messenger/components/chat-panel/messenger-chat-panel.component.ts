import { DatePipe } from '@angular/common';
import {
  AfterViewChecked,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  MessengerChannel,
  MessengerConversation,
  MessengerMessage,
} from '../../models/messenger.models';
import { MessengerReplyComposerComponent } from '../reply-composer/messenger-reply-composer.component';

@Component({
  selector: 'app-messenger-chat-panel',
  imports: [DatePipe, RouterLink, MessengerReplyComposerComponent],
  templateUrl: './messenger-chat-panel.component.html',
  styleUrl: './messenger-chat-panel.component.css',
})
export class MessengerChatPanelComponent implements OnChanges, AfterViewChecked {
  @ViewChild('messageScroller') private messageScroller?: ElementRef<HTMLElement>;

  @Input() conversation: MessengerConversation | null = null;
  @Input() channel: MessengerChannel | null = null;
  @Input() messages: readonly MessengerMessage[] = [];
  @Input() loading = false;
  @Input() loadingOlder = false;
  @Input() hasOlder = false;
  @Input() errorMessage = '';
  @Input() canSend = false;
  @Input() replyWindowOpen = false;
  @Input() draft = '';
  @Input() sending = false;
  @Input() checkingResult = false;
  @Input() uncertain = false;
  @Input() composerError = '';
  @Input() composerNotice = '';
  @Input() currentUserId: string | null = null;
  @Input() currentUserName: string | null = null;
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly loadOlder = new EventEmitter<void>();
  @Output() readonly retry = new EventEmitter<void>();
  @Output() readonly draftChange = new EventEmitter<string>();
  @Output() readonly send = new EventEmitter<void>();
  @Output() readonly checkResult = new EventEmitter<void>();
  @Output() readonly linkRequested = new EventEmitter<void>();

  protected newMessageCount = 0;
  private lastConversationId: string | null = null;
  private lastMessageId: string | null = null;
  private pendingScrollToBottom = false;
  private restoreScroll: { height: number; top: number } | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    const conversationId = this.conversation?.id ?? null;
    if (conversationId !== this.lastConversationId) {
      this.lastConversationId = conversationId;
      this.lastMessageId = this.messages.at(-1)?.id ?? null;
      this.newMessageCount = 0;
      this.pendingScrollToBottom = true;
      return;
    }
    if (!changes['messages']) return;
    const newestId = this.messages.at(-1)?.id ?? null;
    if (newestId && newestId !== this.lastMessageId && !this.restoreScroll) {
      if (this.isNearBottom()) this.pendingScrollToBottom = true;
      else this.newMessageCount += 1;
    }
    this.lastMessageId = newestId;
  }

  ngAfterViewChecked(): void {
    const scroller = this.messageScroller?.nativeElement;
    if (!scroller) return;
    if (this.restoreScroll) {
      scroller.scrollTop =
        scroller.scrollHeight - this.restoreScroll.height + this.restoreScroll.top;
      this.restoreScroll = null;
    } else if (this.pendingScrollToBottom) {
      this.pendingScrollToBottom = false;
      scroller.scrollTop = scroller.scrollHeight;
    }
  }

  protected requestOlder(): void {
    const scroller = this.messageScroller?.nativeElement;
    if (scroller) this.restoreScroll = { height: scroller.scrollHeight, top: scroller.scrollTop };
    this.loadOlder.emit();
  }

  protected onScroll(): void {
    if (this.isNearBottom()) this.newMessageCount = 0;
  }

  protected scrollToLatest(): void {
    const scroller = this.messageScroller?.nativeElement;
    if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    this.newMessageCount = 0;
  }

  protected statusLabel(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1).replaceAll('_', ' ');
  }

  protected linkedLabel(): string {
    if (this.conversation?.linked_record?.type === 'customer' || this.conversation?.customer_id) {
      return 'Linked customer';
    }
    if (this.conversation?.linked_record?.type === 'lead' || this.conversation?.lead_id) {
      return 'Linked lead';
    }
    return 'Unlinked contact';
  }

  protected pageDisplayName(): string {
    const conversationName = this.conversation?.page_display_name?.trim();
    const channelName = this.channel?.page_display_name?.trim();
    if (channelName && this.channel?.display_name_available) return channelName;
    return conversationName || channelName || 'Facebook Page';
  }

  protected actorLabel(message: MessengerMessage): string {
    const page = this.pageDisplayName();
    if (message.actor_type !== 'crm_user') return page;
    const performer =
      message.actor_user_id && message.actor_user_id === this.currentUserId
        ? this.currentUserName?.trim()
        : '';
    return performer ? `${page} · ${performer} (you)` : `${page} · CRM staff`;
  }

  private isNearBottom(): boolean {
    const scroller = this.messageScroller?.nativeElement;
    return !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96;
  }
}
