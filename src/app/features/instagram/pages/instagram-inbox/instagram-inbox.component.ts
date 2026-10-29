import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Observable, debounceTime, distinctUntilChanged, finalize, map } from 'rxjs';

import { PERMISSIONS } from '../../../../core/models/auth.models';
import { AuthService } from '../../../../core/services/auth.service';
import { CustomersService } from '../../../customers/services/customers.service';
import { leadErrorDetails } from '../../../leads/services/lead-errors';
import { LeadsService } from '../../../leads/services/leads.service';
import { MessengerChatPanelComponent } from '../../../messenger/components/chat-panel/messenger-chat-panel.component';
import { MessengerConversationListComponent } from '../../../messenger/components/conversation-list/messenger-conversation-list.component';
import { MessagingConversationView } from '../../../messages/models/messaging-view.models';
import { instagramSendFailure } from '../../instagram-errors';
import {
  INSTAGRAM_CONVERSATION_PAGE_SIZE,
  INSTAGRAM_MESSAGE_PAGE_SIZE,
  INSTAGRAM_REPLY_MAX_CHARACTERS,
  INSTAGRAM_REPLY_MAX_UTF8_BYTES,
  InstagramChannel,
  InstagramConversation,
  InstagramConversationLinkRequest,
  InstagramMessage,
  InstagramRecoveryResult,
  PendingInstagramReply,
  instagramReplyIsValid,
} from '../../models/instagram.models';
import { InstagramService } from '../../services/instagram.service';

interface LinkOption {
  id: string;
  label: string;
  subtitle: string;
}

interface ConversationLoad {
  page: number;
  refresh: boolean;
  generation: number;
  search: string;
}

interface MessageLoad {
  conversationId: string;
  page: number;
  refresh: boolean;
  generation: number;
}

const MOBILE_MEDIA_QUERY = '(max-width: 760px)';
const POLL_INTERVAL_MS = 15_000;

@Component({
  selector: 'app-instagram-inbox',
  imports: [ReactiveFormsModule, MessengerConversationListComponent, MessengerChatPanelComponent],
  templateUrl: './instagram-inbox.component.html',
  styleUrl: '../../../messenger/pages/messenger-inbox/messenger-inbox.component.css',
})
export class InstagramInboxComponent implements OnInit, OnDestroy {
  private readonly instagram = inject(InstagramService);
  private readonly leads = inject(LeadsService);
  private readonly customers = inject(CustomersService);
  protected readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  @ViewChild('linkDialog') private linkDialog?: ElementRef<HTMLElement>;

  protected readonly permissions = PERMISSIONS;
  protected readonly maxCharacters = INSTAGRAM_REPLY_MAX_CHARACTERS;
  protected readonly maxUtf8Bytes = INSTAGRAM_REPLY_MAX_UTF8_BYTES;
  protected readonly channel = signal<InstagramChannel | null>(null);
  protected readonly loadingChannel = signal(true);
  protected readonly channelError = signal('');
  protected readonly conversations = signal<readonly InstagramConversation[]>([]);
  protected readonly selectedConversation = signal<InstagramConversation | null>(null);
  protected readonly messages = signal<readonly InstagramMessage[]>([]);
  protected readonly loadingConversations = signal(false);
  protected readonly refreshingConversations = signal(false);
  protected readonly loadingMoreConversations = signal(false);
  protected readonly conversationError = signal('');
  protected readonly loadingMessages = signal(false);
  protected readonly loadingOlderMessages = signal(false);
  protected readonly messageError = signal('');
  protected readonly sendingContextKey = signal<string | null>(null);
  protected readonly checkingContextKey = signal<string | null>(null);
  protected readonly mobileChatOpen = signal(false);
  protected readonly isMobile = signal(
    this.isBrowser && Boolean(window.matchMedia?.(MOBILE_MEDIA_QUERY).matches),
  );

  private readonly now = signal(Date.now());
  private readonly drafts = signal<Record<string, string>>({});
  private readonly pendingSends = signal<Record<string, PendingInstagramReply>>({});
  private readonly sendErrors = signal<Record<string, string>>({});
  private readonly sendNotices = signal<Record<string, string>>({});
  private readonly uncertainSends = signal<Record<string, boolean>>({});

  protected readonly currentContextKey = computed(() => {
    const conversation = this.selectedConversation();
    return conversation ? this.contextKey(conversation.id) : '';
  });
  protected readonly currentDraft = computed(() => this.drafts()[this.currentContextKey()] ?? '');
  protected readonly currentSendError = computed(
    () => this.sendErrors()[this.currentContextKey()] ?? '',
  );
  protected readonly currentSendNotice = computed(
    () => this.sendNotices()[this.currentContextKey()] ?? '',
  );
  protected readonly currentUncertain = computed(() =>
    Boolean(this.uncertainSends()[this.currentContextKey()]),
  );
  protected readonly replyWindowOpen = computed(() => {
    const eligibility = this.selectedConversation()?.eligibility;
    if (!eligibility?.reply_allowed) return false;
    return !eligibility.window_expires_at || Date.parse(eligibility.window_expires_at) > this.now();
  });
  protected readonly hasMoreConversations = computed(
    () => this.conversationPage() < this.conversationPages(),
  );
  protected readonly hasOlderMessages = computed(() => this.messagePage() < this.messagePages());

  protected readonly linkOpen = signal(false);
  protected readonly linkType = signal<'lead' | 'customer'>('lead');
  protected readonly linkOptions = signal<readonly LinkOption[]>([]);
  protected readonly selectedLinkId = signal('');
  protected readonly loadingLinkOptions = signal(false);
  protected readonly linking = signal(false);
  protected readonly linkError = signal('');
  protected readonly linkSearch = new FormControl('', { nonNullable: true });

  private readonly conversationPage = signal(1);
  private readonly conversationPages = signal(0);
  private readonly messagePage = signal(1);
  private readonly messagePages = signal(0);
  private search = '';
  private conversationGeneration = 0;
  private messageGeneration = 0;
  private conversationRequestActive = false;
  private messageRequestActive = false;
  private pendingConversationLoad: ConversationLoad | null = null;
  private pendingMessageLoad: MessageLoad | null = null;
  private readonly readRequests = new Set<string>();
  private readonly readThrough = new Map<string, number>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private eligibilityTimer: ReturnType<typeof setInterval> | null = null;
  private dialogOpener: HTMLElement | null = null;

  ngOnInit(): void {
    this.loadChannel();
    this.linkSearch.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.linkOpen()) this.loadLinkOptions();
      });
    if (this.isBrowser) {
      this.pollTimer = setInterval(() => this.pollNow(), POLL_INTERVAL_MS);
      this.eligibilityTimer = setInterval(() => {
        const wasOpen = this.replyWindowOpen();
        this.now.set(Date.now());
        if (wasOpen && !this.replyWindowOpen()) {
          const selected = this.selectedConversation();
          if (selected) this.loadMessages(selected.id, 1, true);
        }
      }, 1_000);
    }
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.eligibilityTimer) clearInterval(this.eligibilityTimer);
  }

  @HostListener('window:resize')
  protected onResize(): void {
    if (!this.isBrowser) return;
    const mobile = Boolean(window.matchMedia?.(MOBILE_MEDIA_QUERY).matches);
    const wasMobile = this.isMobile();
    this.isMobile.set(mobile);
    if (wasMobile && !mobile && this.selectedConversation()) this.mobileChatOpen.set(true);
  }

  @HostListener('document:visibilitychange')
  protected onVisibilityChange(): void {
    if (this.document.visibilityState === 'visible') {
      this.pollNow();
      this.markSelectedRead();
    }
  }

  protected retryChannel(): void {
    this.loadChannel();
  }

  protected selectConversation(view: MessagingConversationView): void {
    const conversation = view as InstagramConversation;
    this.selectedConversation.set(conversation);
    this.mobileChatOpen.set(true);
    this.messages.set([]);
    this.messagePage.set(1);
    this.messagePages.set(0);
    this.messageGeneration += 1;
    this.loadMessages(conversation.id, 1, false);
    this.markSelectedRead();
  }

  protected closeMobileChat(): void {
    this.mobileChatOpen.set(false);
  }

  protected searchConversations(value: string): void {
    this.search = value.trim();
    this.conversationGeneration += 1;
    this.loadConversations(1, false);
  }

  protected loadMoreConversations(): void {
    if (this.loadingMoreConversations() || !this.hasMoreConversations()) return;
    this.loadConversations(this.conversationPage() + 1, false);
  }

  protected retryConversations(): void {
    this.loadConversations(1, false);
  }

  protected loadOlderMessages(): void {
    const conversation = this.selectedConversation();
    if (!conversation || this.loadingOlderMessages() || !this.hasOlderMessages()) return;
    this.loadMessages(conversation.id, this.messagePage() + 1, false);
  }

  protected retryMessages(): void {
    const conversation = this.selectedConversation();
    if (conversation) this.loadMessages(conversation.id, 1, false);
  }

  protected updateDraft(value: string): void {
    const key = this.currentContextKey();
    if (!key) return;
    this.patchRecord(this.drafts, key, value);
    this.patchRecord(this.sendErrors, key, '');
    this.patchRecord(this.sendNotices, key, '');
  }

  protected sendReply(): void {
    const conversation = this.selectedConversation();
    const channel = this.channel();
    const contextKey = this.currentContextKey();
    const textSnapshot = this.currentDraft();
    if (
      !conversation ||
      !channel ||
      !contextKey ||
      !this.auth.hasPermission(PERMISSIONS.messagesSend) ||
      !channel.ready ||
      !channel.active ||
      !this.replyWindowOpen() ||
      !instagramReplyIsValid(textSnapshot) ||
      this.sendingContextKey() ||
      this.currentUncertain()
    ) {
      return;
    }
    const request = Object.freeze({
      text: textSnapshot,
      idempotency_key: this.createIdempotencyKey(),
    });
    const pending = Object.freeze<PendingInstagramReply>({
      channelId: channel.id,
      conversationId: conversation.id,
      contextKey,
      textSnapshot,
      request,
    });
    this.patchRecord(this.pendingSends, contextKey, pending);
    this.submitSend(pending);
  }

  protected checkResult(): void {
    const contextKey = this.currentContextKey();
    const pending = this.pendingSends()[contextKey];
    if (!pending || !this.uncertainSends()[contextKey] || this.checkingContextKey()) return;
    this.checkingContextKey.set(contextKey);
    this.patchRecord(this.sendErrors, contextKey, '');
    this.instagram
      .recover(pending.request.idempotency_key)
      .pipe(
        finalize(() => {
          if (this.checkingContextKey() === contextKey) this.checkingContextKey.set(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => this.handleRecovery(pending, data),
        error: (error: unknown) =>
          this.patchRecord(
            this.sendErrors,
            contextKey,
            `${this.errorMessage(error, 'Unable to check the original reply result.')} No message was resent.`,
          ),
      });
  }

  protected openLinkDialog(): void {
    if (!this.auth.hasPermission(PERMISSIONS.messagesSend) || !this.selectedConversation()) return;
    this.dialogOpener =
      this.document.activeElement instanceof HTMLElement ? this.document.activeElement : null;
    this.linkType.set('lead');
    this.linkSearch.setValue('', { emitEvent: false });
    this.selectedLinkId.set('');
    this.linkError.set('');
    this.linkOpen.set(true);
    this.loadLinkOptions();
    if (this.isBrowser) {
      setTimeout(() => this.linkDialog?.nativeElement.querySelector<HTMLElement>('input')?.focus());
    }
  }

  protected closeLinkDialog(): void {
    if (this.linking()) return;
    this.linkOpen.set(false);
    if (this.isBrowser) setTimeout(() => this.dialogOpener?.focus());
  }

  protected changeLinkType(value: string): void {
    this.linkType.set(value === 'customer' ? 'customer' : 'lead');
    this.selectedLinkId.set('');
    this.loadLinkOptions();
  }

  protected chooseLink(id: string): void {
    this.selectedLinkId.set(id);
  }

  protected linkConversation(): void {
    const conversation = this.selectedConversation();
    const targetId = this.selectedLinkId();
    if (!conversation || !targetId || this.linking()) return;
    const request: InstagramConversationLinkRequest =
      this.linkType() === 'lead' ? { lead_id: targetId } : { customer_id: targetId };
    this.linking.set(true);
    this.linkError.set('');
    this.instagram
      .link(conversation.id, request)
      .pipe(
        finalize(() => this.linking.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.updateConversation(data);
          this.linkOpen.set(false);
          if (this.isBrowser) setTimeout(() => this.dialogOpener?.focus());
        },
        error: (error: unknown) =>
          this.linkError.set(this.errorMessage(error, 'Unable to link this conversation.')),
      });
  }

  private loadChannel(): void {
    this.loadingChannel.set(true);
    this.channelError.set('');
    this.instagram
      .getChannel()
      .pipe(
        finalize(() => this.loadingChannel.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.channel.set(data);
          this.conversationGeneration += 1;
          this.loadConversations(1, false);
        },
        error: (error: unknown) => {
          this.channel.set(null);
          this.channelError.set(this.channelErrorMessage(error));
        },
      });
  }

  private loadConversations(page: number, refresh: boolean): void {
    const load: ConversationLoad = {
      page,
      refresh,
      generation: this.conversationGeneration,
      search: this.search,
    };
    if (this.conversationRequestActive) {
      this.pendingConversationLoad = load;
      return;
    }
    this.conversationRequestActive = true;
    if (refresh) this.refreshingConversations.set(true);
    else if (page > 1) this.loadingMoreConversations.set(true);
    else this.loadingConversations.set(true);
    if (!refresh) this.conversationError.set('');

    this.instagram
      .listConversations(page, INSTAGRAM_CONVERSATION_PAGE_SIZE, load.search)
      .pipe(
        finalize(() => {
          this.conversationRequestActive = false;
          if (load.generation === this.conversationGeneration) {
            this.loadingConversations.set(false);
            this.refreshingConversations.set(false);
            this.loadingMoreConversations.set(false);
          }
          const queued = this.pendingConversationLoad;
          this.pendingConversationLoad = null;
          if (queued) this.loadConversations(queued.page, queued.refresh);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          if (load.generation !== this.conversationGeneration || load.search !== this.search)
            return;
          this.conversationPage.set(
            refresh ? Math.max(this.conversationPage(), data.page) : data.page,
          );
          this.conversationPages.set(data.pages);
          const received = data.items.map((item) => this.normalizeUnread(item));
          const items =
            page === 1 && !refresh
              ? this.sortConversations(received)
              : this.mergeConversations(this.conversations(), received);
          this.conversations.set(items);
          this.conversationError.set('');
          const selected = this.selectedConversation();
          const updated = selected && items.find((item) => item.id === selected.id);
          if (updated) this.selectedConversation.set(this.mergeConversation(selected, updated));
          else if (!selected && !this.isMobile() && items[0]) this.selectConversation(items[0]);
        },
        error: (error: unknown) => {
          if (load.generation === this.conversationGeneration) {
            this.conversationError.set(
              this.errorMessage(error, 'Unable to load Instagram conversations.'),
            );
          }
        },
      });
  }

  private loadMessages(conversationId: string, page: number, refresh: boolean): void {
    const load: MessageLoad = {
      conversationId,
      page,
      refresh,
      generation: this.messageGeneration,
    };
    if (this.messageRequestActive) {
      this.pendingMessageLoad = load;
      return;
    }
    this.messageRequestActive = true;
    if (page > 1) this.loadingOlderMessages.set(true);
    else if (!refresh) this.loadingMessages.set(true);
    if (!refresh) this.messageError.set('');

    this.instagram
      .listMessages(conversationId, page, INSTAGRAM_MESSAGE_PAGE_SIZE)
      .pipe(
        finalize(() => {
          this.messageRequestActive = false;
          if (load.generation === this.messageGeneration) {
            this.loadingMessages.set(false);
            this.loadingOlderMessages.set(false);
          }
          const queued = this.pendingMessageLoad;
          this.pendingMessageLoad = null;
          if (queued) this.loadMessages(queued.conversationId, queued.page, queued.refresh);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          if (
            load.generation !== this.messageGeneration ||
            this.selectedConversation()?.id !== conversationId
          ) {
            return;
          }
          this.messagePages.set(data.pages);
          this.messagePage.set(refresh ? Math.max(this.messagePage(), data.page) : data.page);
          const items =
            page === 1 && !refresh
              ? this.mergeMessages([], data.items)
              : this.mergeMessages(this.messages(), data.items);
          this.messages.set(items);
          this.messageError.set('');
          this.updateConversation(data.conversation);
          this.reconcilePendingFromMessages(items);
          this.markSelectedRead();
        },
        error: (error: unknown) => {
          if (
            load.generation === this.messageGeneration &&
            this.selectedConversation()?.id === conversationId
          ) {
            this.messageError.set(this.errorMessage(error, 'Unable to load message history.'));
          }
        },
      });
  }

  private submitSend(pending: PendingInstagramReply): void {
    this.sendingContextKey.set(pending.contextKey);
    this.patchRecord(this.sendErrors, pending.contextKey, '');
    this.patchRecord(this.sendNotices, pending.contextKey, '');
    this.instagram
      .reply(pending.conversationId, pending.request)
      .pipe(
        finalize(() => {
          if (this.sendingContextKey() === pending.contextKey) this.sendingContextKey.set(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.reconcileMessage(data.message);
          if (data.message.status === 'failed') {
            this.finishDefinitiveFailure(
              pending,
              data.message.failure_reason || 'Meta rejected the Instagram reply.',
            );
            return;
          }
          if (data.operation_state === 'in_progress' || data.message.status === 'unknown') {
            this.patchRecord(
              this.pendingSends,
              pending.contextKey,
              Object.freeze({ ...pending, messageId: data.message.id }),
            );
            this.patchRecord(this.uncertainSends, pending.contextKey, true);
            this.patchRecord(
              this.sendErrors,
              pending.contextKey,
              data.message.failure_reason ||
                'Instagram acceptance is not confirmed. Check the original result; no automatic retry will occur.',
            );
            return;
          }
          this.completePendingSend(pending);
          this.patchRecord(
            this.sendNotices,
            pending.contextKey,
            data.message.status === 'accepted'
              ? 'Reply accepted by Meta. This does not mean delivered or read.'
              : `Reply ${data.message.status}.`,
          );
          this.refreshConversationList();
        },
        error: (error: unknown) => {
          const failure = instagramSendFailure(error);
          if (failure.uncertain) {
            this.patchRecord(this.uncertainSends, pending.contextKey, true);
            this.patchRecord(this.sendErrors, pending.contextKey, failure.message);
          } else {
            this.finishDefinitiveFailure(pending, failure.message);
          }
        },
      });
  }

  private handleRecovery(pending: PendingInstagramReply, recovery: InstagramRecoveryResult): void {
    if (recovery.idempotency_key !== pending.request.idempotency_key) {
      this.patchRecord(
        this.sendErrors,
        pending.contextKey,
        'The recovery response did not match the original request. No new message was sent.',
      );
      return;
    }
    if (!recovery.found || !recovery.message) {
      this.patchRecord(
        this.sendErrors,
        pending.contextKey,
        'The original result is still unknown. No message was resent; use Check Result again later.',
      );
      return;
    }
    this.reconcileMessage(recovery.message);
    if (recovery.operation_state === 'in_progress' || recovery.message.status === 'unknown') {
      this.patchRecord(
        this.pendingSends,
        pending.contextKey,
        Object.freeze({ ...pending, messageId: recovery.message.id }),
      );
      this.patchRecord(
        this.sendErrors,
        pending.contextKey,
        'The original reply is still processing or uncertain. It was not resent; check again later.',
      );
      return;
    }
    if (recovery.message.status === 'failed') {
      this.finishDefinitiveFailure(
        pending,
        recovery.message.failure_reason || 'Meta rejected the Instagram reply.',
      );
      return;
    }
    this.completePendingSend(pending);
    this.patchRecord(
      this.sendNotices,
      pending.contextKey,
      'The original reply result was recovered. No duplicate was sent.',
    );
    this.refreshConversationList();
  }

  private reconcilePendingFromMessages(messages: readonly InstagramMessage[]): void {
    const contextKey = this.currentContextKey();
    const pending = this.pendingSends()[contextKey];
    if (!pending?.messageId || !this.uncertainSends()[contextKey]) return;
    const message = messages.find((item) => item.id === pending.messageId);
    if (!message || message.status === 'unknown') return;
    if (message.status === 'failed') {
      this.finishDefinitiveFailure(
        pending,
        message.failure_reason || 'Meta rejected the Instagram reply.',
      );
      return;
    }
    this.completePendingSend(pending);
    this.patchRecord(
      this.sendNotices,
      contextKey,
      `The original reply is now ${message.status}. No duplicate was sent.`,
    );
  }

  private completePendingSend(pending: PendingInstagramReply): void {
    if (this.drafts()[pending.contextKey] === pending.textSnapshot) {
      this.patchRecord(this.drafts, pending.contextKey, '');
    }
    this.removeRecord(this.pendingSends, pending.contextKey);
    this.patchRecord(this.uncertainSends, pending.contextKey, false);
    this.patchRecord(this.sendErrors, pending.contextKey, '');
  }

  private finishDefinitiveFailure(pending: PendingInstagramReply, reason: string): void {
    this.removeRecord(this.pendingSends, pending.contextKey);
    this.patchRecord(this.uncertainSends, pending.contextKey, false);
    this.patchRecord(this.sendErrors, pending.contextKey, reason);
    if (this.selectedConversation()?.id === pending.conversationId) {
      this.loadMessages(pending.conversationId, 1, true);
    }
  }

  private loadLinkOptions(): void {
    const type = this.linkType();
    const search = this.linkSearch.value.trim();
    this.loadingLinkOptions.set(true);
    this.linkError.set('');
    const request$: Observable<readonly LinkOption[]> =
      type === 'lead'
        ? this.leads.list(1, 50, { search }).pipe(
            map(({ data }) =>
              data.items.map((item) => ({
                id: item.id,
                label: `${item.first_name} ${item.last_name}`.trim() || item.email,
                subtitle: `${item.tracking_id} · ${item.email}`,
              })),
            ),
          )
        : this.customers.list(1, 50, search).pipe(
            map(({ data }) =>
              data.items.map((item) => ({
                id: item.id,
                label: `${item.first_name} ${item.last_name}`.trim() || item.email,
                subtitle: item.email,
              })),
            ),
          );
    request$
      .pipe(
        finalize(() => this.loadingLinkOptions.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (options) => {
          if (type === this.linkType()) this.linkOptions.set(options);
        },
        error: (error: unknown) => {
          this.linkOptions.set([]);
          this.linkError.set(this.errorMessage(error, 'Unable to load accessible records.'));
        },
      });
  }

  private pollNow(): void {
    if (
      !this.channel() ||
      !this.auth.isAuthenticated() ||
      this.document.visibilityState === 'hidden'
    ) {
      return;
    }
    this.refreshConversationList();
    const selected = this.selectedConversation();
    if (selected && (!this.isMobile() || this.mobileChatOpen())) {
      this.loadMessages(selected.id, 1, true);
    }
  }

  private refreshConversationList(): void {
    this.loadConversations(1, true);
  }

  private markSelectedRead(): void {
    const selected = this.selectedConversation();
    if (
      !selected ||
      selected.unread_count <= 0 ||
      this.document.visibilityState !== 'visible' ||
      (this.isMobile() && !this.mobileChatOpen()) ||
      this.readRequests.has(selected.id)
    ) {
      return;
    }
    const conversationId = selected.id;
    this.readRequests.add(conversationId);
    this.instagram
      .markRead(conversationId)
      .pipe(
        finalize(() => this.readRequests.delete(conversationId)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.readThrough.set(conversationId, Date.parse(data.last_read_at));
          const current = this.conversations().find((item) => item.id === conversationId);
          if (current) this.updateConversation({ ...current, unread_count: 0 });
        },
        error: () => undefined,
      });
  }

  private updateConversation(conversation: InstagramConversation): void {
    conversation = this.normalizeUnread(conversation);
    this.conversations.update((items) =>
      items.map((item) =>
        item.id === conversation.id ? this.mergeConversation(item, conversation) : item,
      ),
    );
    const selected = this.selectedConversation();
    if (selected?.id === conversation.id) {
      this.selectedConversation.set(this.mergeConversation(selected, conversation));
    }
  }

  private normalizeUnread(conversation: InstagramConversation): InstagramConversation {
    const readAt = this.readThrough.get(conversation.id);
    const inboundAt = conversation.last_inbound_at ? Date.parse(conversation.last_inbound_at) : 0;
    return readAt !== undefined && inboundAt <= readAt
      ? { ...conversation, unread_count: 0 }
      : conversation;
  }

  private reconcileMessage(message: InstagramMessage): void {
    if (this.selectedConversation()?.id !== message.conversation_id) return;
    this.messages.set(this.mergeMessages(this.messages(), [message]));
  }

  private sortConversations(items: readonly InstagramConversation[]): InstagramConversation[] {
    return [...items].sort(
      (a, b) =>
        Date.parse(b.last_message_at) - Date.parse(a.last_message_at) || b.id.localeCompare(a.id),
    );
  }

  private mergeConversations(
    current: readonly InstagramConversation[],
    incoming: readonly InstagramConversation[],
  ): InstagramConversation[] {
    const byId = new Map(current.map((item) => [item.id, item]));
    for (const item of incoming) {
      const existing = byId.get(item.id);
      byId.set(item.id, existing ? this.mergeConversation(existing, item) : item);
    }
    return this.sortConversations(Array.from(byId.values()));
  }

  private mergeConversation(
    current: InstagramConversation,
    incoming: InstagramConversation,
  ): InstagramConversation {
    const sourceRank = { fallback: 0, provider_profile: 1, linked_record: 2 } as const;
    const keepCurrentContact =
      sourceRank[current.contact_display_name_source] >
      sourceRank[incoming.contact_display_name_source];
    return {
      ...current,
      ...incoming,
      ...(keepCurrentContact
        ? {
            contact_display_name: current.contact_display_name,
            display_name_available: current.display_name_available,
            contact_display_name_source: current.contact_display_name_source,
          }
        : {}),
      account_display_name:
        incoming.account_display_name.trim() ||
        current.account_display_name.trim() ||
        'Instagram account',
    };
  }

  private mergeMessages(
    current: readonly InstagramMessage[],
    incoming: readonly InstagramMessage[],
  ): InstagramMessage[] {
    const byId = new Map(current.map((message) => [message.id, message]));
    const providerIds = new Map(
      current
        .filter((message) => message.provider_message_id)
        .map((message) => [message.provider_message_id as string, message.id]),
    );
    for (const message of incoming) {
      const existingId = message.provider_message_id
        ? providerIds.get(message.provider_message_id)
        : undefined;
      const key = existingId ?? message.id;
      byId.set(key, { ...byId.get(key), ...message, id: key });
      if (message.provider_message_id) providerIds.set(message.provider_message_id, key);
    }
    return Array.from(byId.values()).sort(
      (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.id.localeCompare(b.id),
    );
  }

  private contextKey(conversationId: string): string {
    return `${this.channel()?.id ?? 'instagram'}:${conversationId}`;
  }

  private createIdempotencyKey(): string {
    const id = globalThis.crypto?.randomUUID?.();
    return id
      ? `instagram-${id}`
      : `instagram-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private channelErrorMessage(error: unknown): string {
    if (
      error instanceof HttpErrorResponse &&
      error.error?.detail?.code === 'meta_instagram_channel_not_configured'
    ) {
      return 'This workspace has no configured Instagram account. Ask a workspace administrator to configure the Meta Instagram channel and map it to this workspace.';
    }
    return this.errorMessage(error, 'The workspace Instagram account channel is unavailable.');
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.status === 403) {
      return 'You do not have permission to perform this Instagram action in the current workspace.';
    }
    return leadErrorDetails(error, fallback).message;
  }

  private patchRecord<T>(
    target: { update: (fn: (value: Record<string, T>) => Record<string, T>) => void },
    key: string,
    value: T,
  ): void {
    target.update((record) => ({ ...record, [key]: value }));
  }

  private removeRecord<T>(
    target: { update: (fn: (value: Record<string, T>) => Record<string, T>) => void },
    key: string,
  ): void {
    target.update((record) => {
      const next = { ...record };
      delete next[key];
      return next;
    });
  }
}
