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

import { MetaApprovedTemplate, MetaWhatsAppPurpose } from '../../models/meta-whatsapp.models';
import {
  WhatsAppChannelOption,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppProvider,
} from '../../models/whatsapp.models';
import { WhatsAppReplyComposerComponent } from '../reply-composer/whatsapp-reply-composer.component';

@Component({
  selector: 'app-whatsapp-chat-panel',
  imports: [DatePipe, RouterLink, WhatsAppReplyComposerComponent],
  templateUrl: './whatsapp-chat-panel.component.html',
  styleUrl: './whatsapp-chat-panel.component.css',
})
export class WhatsAppChatPanelComponent implements OnChanges, AfterViewChecked {
  @ViewChild('messageScroller') private messageScroller?: ElementRef<HTMLElement>;

  @Input() conversation: WhatsAppConversation | null = null;
  @Input() messages: readonly WhatsAppMessage[] = [];
  @Input() loading = false;
  @Input() loadingOlder = false;
  @Input() hasOlder = false;
  @Input() errorMessage = '';
  @Input() canSend = false;
  @Input() draft = '';
  @Input() sending = false;
  @Input() checkingResult = false;
  @Input() uncertain = false;
  @Input() composerError = '';
  @Input() composerNotice = '';
  @Input() provider: WhatsAppProvider = 'twilio';
  @Input() channel: WhatsAppChannelOption | null = null;
  @Input() templates: readonly MetaApprovedTemplate[] = [];
  @Input() templatesLoading = false;
  @Input() templatesError = '';
  @Input() templateName = '';
  @Input() templateLanguage = '';
  @Input() templateVariables: Readonly<Record<string, string>> = {};
  @Input() purpose: MetaWhatsAppPurpose = 'lead_acquisition';
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly loadOlder = new EventEmitter<void>();
  @Output() readonly retry = new EventEmitter<void>();
  @Output() readonly draftChange = new EventEmitter<string>();
  @Output() readonly send = new EventEmitter<void>();
  @Output() readonly checkResult = new EventEmitter<void>();
  @Output() readonly linkRequested = new EventEmitter<void>();
  @Output() readonly templateNameChange = new EventEmitter<string>();
  @Output() readonly templateLanguageChange = new EventEmitter<string>();
  @Output() readonly templateVariableChange = new EventEmitter<{ key: string; value: string }>();
  @Output() readonly purposeChange = new EventEmitter<MetaWhatsAppPurpose>();
  @Output() readonly retryTemplates = new EventEmitter<void>();

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

  protected displayName(): string {
    const conversation = this.conversation;
    if (!conversation) return '';
    return conversation.contact_name?.trim() || this.displayAddress(conversation.external_address);
  }

  protected displayAddress(address: string): string {
    return address.replace(/^whatsapp:/i, '');
  }

  protected statusLabel(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  protected linkedLabel(): string {
    if (this.conversation?.customer_id) return 'Linked customer';
    if (this.conversation?.lead_id) return 'Linked lead';
    return 'Unlinked contact';
  }

  private isNearBottom(): boolean {
    const scroller = this.messageScroller?.nativeElement;
    return !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96;
  }
}
