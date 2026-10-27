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
import { LeadsService } from '../../../leads/services/leads.service';
import { leadErrorDetails } from '../../../leads/services/lead-errors';
import { WhatsAppChatPanelComponent } from '../../components/chat-panel/whatsapp-chat-panel.component';
import { WhatsAppConversationListComponent } from '../../components/conversation-list/whatsapp-conversation-list.component';
import {
  MetaApprovedTemplate,
  MetaTemplateSendRequest,
  MetaTextSendRequest,
  MetaWhatsAppConversation,
  MetaWhatsAppMessage,
  MetaWhatsAppPurpose,
  MetaWhatsAppRecoveryResult,
  MetaWhatsAppSendRequest,
} from '../../models/meta-whatsapp.models';
import {
  ApiDataResponse,
  WHATSAPP_CONVERSATION_PAGE_SIZE,
  WHATSAPP_MESSAGE_PAGE_SIZE,
  WhatsAppChannelOption,
  WhatsAppConversation,
  WhatsAppConversationLinkRequest,
  WhatsAppConversationPage,
  WhatsAppMessage,
  WhatsAppMessagePage,
  WhatsAppProvider,
  WhatsAppRecoveryResult,
  WhatsAppReplyRequest,
} from '../../models/whatsapp.models';
import { MetaWhatsAppService } from '../../services/meta-whatsapp.service';
import { WhatsAppService } from '../../services/whatsapp.service';
import { whatsappSendFailure } from '../../whatsapp-errors';

interface LinkOption {
  id: string;
  label: string;
  subtitle: string;
}

interface TemplateDraft {
  name: string;
  language: string;
  variables: Readonly<Record<string, string>>;
  purpose: MetaWhatsAppPurpose;
}

interface PendingSend {
  provider: WhatsAppProvider;
  conversationId: string;
  contextKey: string;
  textSnapshot: string | null;
  request: Readonly<WhatsAppReplyRequest | MetaWhatsAppSendRequest>;
}

const MOBILE_MEDIA_QUERY = '(max-width: 760px)';
const POLL_INTERVAL_MS = 15_000;
const HIDDEN_POLL_INTERVAL_MS = 60_000;
const INTERNATIONAL_PHONE = /^\+[1-9]\d{7,14}$/;
const TWILIO_CHANNEL: WhatsAppChannelOption = {
  provider: 'twilio',
  id: 'twilio-existing',
  label: 'Existing Twilio WhatsApp',
  senderAddress: null,
  accountId: null,
  channelId: null,
};

@Component({
  selector: 'app-whatsapp-inbox',
  imports: [ReactiveFormsModule, WhatsAppConversationListComponent, WhatsAppChatPanelComponent],
  templateUrl: './whatsapp-inbox.component.html',
  styleUrl: './whatsapp-inbox.component.css',
})
export class WhatsAppInboxComponent implements OnInit, OnDestroy {
  private readonly twilio = inject(WhatsAppService);
  private readonly meta = inject(MetaWhatsAppService);
  private readonly leads = inject(LeadsService);
  private readonly customers = inject(CustomersService);
  protected readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  @ViewChild('linkDialog') private linkDialog?: ElementRef<HTMLElement>;
  @ViewChild('newChatDialog') private newChatDialog?: ElementRef<HTMLElement>;

  protected readonly permissions = PERMISSIONS;
  protected readonly channels = signal<readonly WhatsAppChannelOption[]>([TWILIO_CHANNEL]);
  protected readonly selectedProvider = signal<WhatsAppProvider>('twilio');
  protected readonly currentChannel = computed(
    () => this.channels().find((channel) => channel.provider === this.selectedProvider()) ?? null,
  );
  protected readonly conversations = signal<readonly WhatsAppConversation[]>([]);
  protected readonly selectedConversation = signal<WhatsAppConversation | null>(null);
  protected readonly messages = signal<readonly WhatsAppMessage[]>([]);
  protected readonly loadingConversations = signal(true);
  protected readonly refreshingConversations = signal(false);
  protected readonly loadingMoreConversations = signal(false);
  protected readonly conversationError = signal('');
  protected readonly loadingMessages = signal(false);
  protected readonly loadingOlderMessages = signal(false);
  protected readonly messageError = signal('');
  protected readonly sendingContextKey = signal<string | null>(null);
  protected readonly checkingContextKey = signal<string | null>(null);
  protected readonly isMobile = signal(
    this.isBrowser && Boolean(window.matchMedia?.(MOBILE_MEDIA_QUERY).matches),
  );
  protected readonly mobileChatOpen = signal(false);

  private readonly drafts = signal<Record<string, string>>({});
  private readonly templateDrafts = signal<Record<string, TemplateDraft>>({});
  private readonly pendingSends = signal<Record<string, PendingSend>>({});
  private readonly sendErrors = signal<Record<string, string>>({});
  private readonly sendNotices = signal<Record<string, string>>({});
  private readonly uncertainSends = signal<Record<string, boolean>>({});

  protected readonly currentContextKey = computed(() => {
    const conversation = this.selectedConversation();
    return conversation ? this.contextKey(this.selectedProvider(), conversation.id) : '';
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

  protected readonly approvedTemplates = signal<readonly MetaApprovedTemplate[]>([]);
  protected readonly templatesLoading = signal(false);
  protected readonly templatesError = signal('');
  protected readonly currentTemplateDraft = computed<TemplateDraft>(() => {
    const key = this.currentContextKey();
    const saved = this.templateDrafts()[key];
    if (saved) return saved;
    return {
      name: '',
      language: '',
      variables: {},
      purpose: this.selectedConversation()?.customer_id ? 'customer_service' : 'lead_acquisition',
    };
  });

  protected readonly linkOpen = signal(false);
  protected readonly linkType = signal<'lead' | 'customer'>('lead');
  protected readonly linkOptions = signal<readonly LinkOption[]>([]);
  protected readonly selectedLinkId = signal('');
  protected readonly loadingLinkOptions = signal(false);
  protected readonly linking = signal(false);
  protected readonly linkError = signal('');
  protected readonly linkSearch = new FormControl('', { nonNullable: true });

  protected readonly newChatOpen = signal(false);
  protected readonly newChatPhone = new FormControl('', { nonNullable: true });
  protected readonly openingConversation = signal(false);
  protected readonly newChatError = signal('');
  protected readonly newChatLinkType = signal<'lead' | 'customer'>('lead');
  protected readonly newChatOptions = signal<readonly LinkOption[]>([]);
  protected readonly newChatSelectedLinkId = signal('');
  protected readonly loadingNewChatOptions = signal(false);
  protected readonly newChatSearch = new FormControl('', { nonNullable: true });

  private conversationPage = 1;
  private conversationPages = 0;
  private messagePage = 1;
  private messagePages = 0;
  private search = '';
  private conversationRequestActive = false;
  private messageRequestActive = false;
  private pendingConversationLoad: { page: number; refresh: boolean } | null = null;
  private pendingMessageLoad: { conversationId: string; page: number; refresh: boolean } | null =
    null;
  private readRequests = new Set<string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastHiddenPollAt = 0;
  private channelEpoch = 0;
  private dialogOpener: HTMLElement | null = null;

  protected readonly hasMoreConversations = computed(
    () => this.conversationPage < this.conversationPages,
  );
  protected readonly hasOlderMessages = computed(() => this.messagePage < this.messagePages);

  ngOnInit(): void {
    this.discoverMetaChannel();
    this.loadConversations(1, false);
    this.linkSearch.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.linkOpen()) this.loadLinkOptions();
      });
    this.newChatSearch.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.newChatOpen()) this.loadNewChatOptions();
      });
    if (this.isBrowser) this.startPolling();
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
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

  @HostListener('document:keydown', ['$event'])
  protected onDocumentKeydown(event: KeyboardEvent): void {
    const dialog = this.activeDialog();
    if (!dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.newChatOpen()) this.closeNewChatDialog();
      else this.closeLinkDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && this.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected changeProvider(provider: WhatsAppProvider): void {
    if (
      provider === this.selectedProvider() ||
      !this.channels().some((c) => c.provider === provider)
    ) {
      return;
    }
    this.selectedProvider.set(provider);
    this.channelEpoch += 1;
    this.resetVisibleInbox();
    this.loadConversations(1, false);
  }

  protected selectConversation(conversation: WhatsAppConversation): void {
    this.selectedConversation.set(conversation);
    this.mobileChatOpen.set(true);
    this.messages.set([]);
    this.messagePage = 1;
    this.messagePages = 0;
    this.loadMessages(conversation.id, 1, false);
    this.ensureTemplatesFor(conversation);
    this.markSelectedRead();
  }

  protected closeMobileChat(): void {
    this.mobileChatOpen.set(false);
  }

  protected searchConversations(value: string): void {
    this.search = value.trim();
    this.loadConversations(1, false);
  }

  protected loadMoreConversations(): void {
    if (this.loadingMoreConversations() || !this.hasMoreConversations()) return;
    this.loadConversations(this.conversationPage + 1, false);
  }

  protected retryConversations(): void {
    this.loadConversations(1, false);
  }

  protected loadOlderMessages(): void {
    const conversation = this.selectedConversation();
    if (!conversation || this.loadingOlderMessages() || !this.hasOlderMessages()) return;
    this.loadMessages(conversation.id, this.messagePage + 1, false);
  }

  protected retryMessages(): void {
    const conversation = this.selectedConversation();
    if (conversation) this.loadMessages(conversation.id, 1, false);
  }

  protected updateDraft(value: string): void {
    const key = this.currentContextKey();
    if (!key) return;
    this.patchRecord(this.drafts, key, value);
    this.clearFeedback(key);
  }

  protected changeTemplateName(name: string): void {
    const template = this.approvedTemplates().find((item) => item.name === name);
    if (!template) return;
    this.saveTemplateDraft({
      ...this.currentTemplateDraft(),
      name,
      language: template.language,
      variables: {},
    });
  }

  protected changeTemplateLanguage(language: string): void {
    this.saveTemplateDraft({ ...this.currentTemplateDraft(), language, variables: {} });
  }

  protected changeTemplateVariable(change: { key: string; value: string }): void {
    const draft = this.currentTemplateDraft();
    this.saveTemplateDraft({
      ...draft,
      variables: { ...draft.variables, [change.key]: change.value },
    });
  }

  protected changePurpose(purpose: MetaWhatsAppPurpose): void {
    this.saveTemplateDraft({ ...this.currentTemplateDraft(), purpose });
  }

  protected sendReply(): void {
    const conversation = this.selectedConversation();
    const provider = this.selectedProvider();
    const key = this.currentContextKey();
    if (
      !conversation ||
      !key ||
      !this.auth.hasPermission(PERMISSIONS.messagesSend) ||
      this.sendingContextKey() ||
      this.currentUncertain()
    ) {
      return;
    }

    let request: Readonly<WhatsAppReplyRequest | MetaWhatsAppSendRequest>;
    let textSnapshot: string | null = null;
    if (provider === 'twilio') {
      if (!conversation.free_form_reply_allowed || !this.currentDraft().trim()) return;
      textSnapshot = this.currentDraft();
      request = Object.freeze({
        body: textSnapshot,
        idempotency_key: this.createIdempotencyKey(provider),
      });
    } else if (conversation.free_form_reply_allowed) {
      if (!this.currentDraft().trim()) return;
      textSnapshot = this.currentDraft();
      request = Object.freeze<MetaTextSendRequest>({
        conversation_id: conversation.id,
        mode: 'text',
        text: textSnapshot,
        purpose: this.currentTemplateDraft().purpose,
        idempotency_key: this.createIdempotencyKey(provider),
      });
    } else {
      const eligibility = conversation.eligibility;
      const draft = this.currentTemplateDraft();
      const template = this.approvedTemplates().find(
        (item) => item.name === draft.name && item.language === draft.language,
      );
      if (!eligibility?.template_outreach_allowed || !template) return;
      const parameters = template.required_variables.map((variable) => ({
        component: variable.component,
        index: variable.index,
        value: draft.variables[this.variableKey(variable.component, variable.index)] ?? '',
      }));
      if (parameters.some((parameter) => !parameter.value.trim())) return;
      const templateRequest = Object.freeze({
        name: template.name,
        language: template.language,
        parameters: Object.freeze(parameters.map((parameter) => Object.freeze(parameter))),
      });
      request = Object.freeze<MetaTemplateSendRequest>({
        conversation_id: conversation.id,
        mode: 'approved_template',
        template: templateRequest,
        purpose: draft.purpose,
        idempotency_key: this.createIdempotencyKey(provider),
      });
    }

    const pending = Object.freeze<PendingSend>({
      provider,
      conversationId: conversation.id,
      contextKey: key,
      textSnapshot,
      request,
    });
    this.patchRecord(this.pendingSends, key, pending);
    this.submitSend(pending);
  }

  protected checkResult(): void {
    const key = this.currentContextKey();
    const pending = this.pendingSends()[key];
    if (!pending || !this.uncertainSends()[key] || this.checkingContextKey()) return;
    this.checkingContextKey.set(key);
    this.patchRecord(this.sendErrors, key, '');
    const idempotencyKey = pending.request.idempotency_key;
    const recovery$ =
      pending.provider === 'meta'
        ? this.meta
            .recover(idempotencyKey)
            .pipe(map(({ data }) => this.normalizeMetaRecovery(data)))
        : this.twilio.recover(idempotencyKey).pipe(map(({ data }) => data));
    recovery$
      .pipe(
        finalize(() => {
          if (this.checkingContextKey() === key) this.checkingContextKey.set(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (data) => this.handleRecovery(pending, data),
        error: (error: unknown) =>
          this.patchRecord(
            this.sendErrors,
            key,
            `${this.errorMessage(error, 'Unable to check the original send result.')} No message was resent.`,
          ),
      });
  }

  protected openLinkDialog(): void {
    if (!this.auth.hasPermission(PERMISSIONS.messagesSend) || !this.selectedConversation()) return;
    this.rememberDialogOpener();
    this.linkType.set('lead');
    this.linkSearch.setValue('', { emitEvent: false });
    this.selectedLinkId.set('');
    this.linkError.set('');
    this.linkOpen.set(true);
    this.loadLinkOptions();
    this.focusDialog(this.linkDialog, 'input');
  }

  protected closeLinkDialog(): void {
    if (this.linking()) return;
    this.linkOpen.set(false);
    this.restoreDialogFocus();
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
    const request = this.linkRequest(this.linkType(), targetId);
    const epoch = this.channelEpoch;
    const provider = this.selectedProvider();
    this.linking.set(true);
    this.linkError.set('');
    this.linkConversationRequest(provider, conversation.id, request)
      .pipe(
        finalize(() => {
          if (epoch === this.channelEpoch) this.linking.set(false);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (updated) => {
          if (!this.isCurrentChannel(epoch, provider)) return;
          this.updateConversation(updated);
          this.linkOpen.set(false);
          this.restoreDialogFocus();
        },
        error: (error: unknown) => {
          if (this.isCurrentChannel(epoch, provider)) {
            this.linkError.set(this.errorMessage(error, 'Unable to link this conversation.'));
          }
        },
      });
  }

  protected openNewChatDialog(): void {
    if (this.selectedProvider() !== 'meta' || !this.auth.hasPermission(PERMISSIONS.messagesView))
      return;
    this.rememberDialogOpener();
    this.newChatPhone.setValue('', { emitEvent: false });
    this.newChatSearch.setValue('', { emitEvent: false });
    this.newChatLinkType.set('lead');
    this.newChatSelectedLinkId.set('');
    this.newChatError.set('');
    this.newChatOpen.set(true);
    if (this.auth.hasPermission(PERMISSIONS.messagesSend)) this.loadNewChatOptions();
    this.focusDialog(this.newChatDialog, 'input[type="tel"]');
  }

  protected closeNewChatDialog(): void {
    if (this.openingConversation()) return;
    this.newChatOpen.set(false);
    this.restoreDialogFocus();
  }

  protected changeNewChatLinkType(value: string): void {
    this.newChatLinkType.set(value === 'customer' ? 'customer' : 'lead');
    this.newChatSelectedLinkId.set('');
    this.loadNewChatOptions();
  }

  protected chooseNewChatLink(id: string): void {
    this.newChatSelectedLinkId.set(this.newChatSelectedLinkId() === id ? '' : id);
  }

  protected openConversation(): void {
    const phone = this.newChatPhone.value.trim();
    if (!INTERNATIONAL_PHONE.test(phone)) {
      this.newChatError.set(
        'Enter a country-code-inclusive number such as +14155552671. Local numbers are not guessed.',
      );
      return;
    }
    if (this.openingConversation() || this.selectedProvider() !== 'meta') return;
    const epoch = this.channelEpoch;
    this.openingConversation.set(true);
    this.newChatError.set('');
    this.meta
      .openConversation(Object.freeze({ phone_number: phone }))
      .pipe(
        finalize(() => {
          if (epoch === this.channelEpoch) this.openingConversation.set(false);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          if (!this.isCurrentChannel(epoch, 'meta')) return;
          const opened = this.normalizeMetaConversation(data);
          this.conversations.set(this.mergeConversations([opened], this.conversations()));
          this.newChatOpen.set(false);
          this.selectConversation(opened);
          const targetId = this.newChatSelectedLinkId();
          if (targetId && this.auth.hasPermission(PERMISSIONS.messagesSend)) {
            this.linkOpenedConversation(
              opened,
              this.linkRequest(this.newChatLinkType(), targetId),
              epoch,
            );
          } else {
            this.restoreDialogFocus();
          }
        },
        error: (error: unknown) => {
          if (this.isCurrentChannel(epoch, 'meta')) {
            this.newChatError.set(
              this.errorMessage(error, 'Unable to open this Meta WhatsApp conversation.'),
            );
          }
        },
      });
  }

  protected retryTemplates(): void {
    this.loadTemplates(1, []);
  }

  private discoverMetaChannel(): void {
    this.meta
      .getChannel()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          if (!data.active) return;
          const metaChannel: WhatsAppChannelOption = {
            provider: 'meta',
            id: data.id,
            label: 'Meta WhatsApp',
            senderAddress: data.sender_address,
            accountId: data.waba_id,
            channelId: data.phone_number_id,
          };
          this.channels.set([metaChannel, TWILIO_CHANNEL]);
        },
        error: () => undefined,
      });
  }

  private loadConversations(page: number, refresh: boolean): void {
    if (this.conversationRequestActive) {
      if (!refresh) this.pendingConversationLoad = { page, refresh };
      return;
    }
    const provider = this.selectedProvider();
    const epoch = this.channelEpoch;
    const requestedSearch = this.search;
    this.conversationRequestActive = true;
    if (refresh) this.refreshingConversations.set(true);
    else if (page === 1) this.loadingConversations.set(true);
    else this.loadingMoreConversations.set(true);
    this.conversationError.set('');

    this.listConversationsRequest(provider, page, this.search)
      .pipe(
        finalize(() => {
          if (!this.isCurrentChannel(epoch, provider)) return;
          this.conversationRequestActive = false;
          this.loadingConversations.set(false);
          this.refreshingConversations.set(false);
          this.loadingMoreConversations.set(false);
          const pending = this.pendingConversationLoad;
          this.pendingConversationLoad = null;
          if (pending) queueMicrotask(() => this.loadConversations(pending.page, pending.refresh));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          if (!this.isCurrentChannel(epoch, provider) || requestedSearch !== this.search) return;
          this.conversationPage = refresh ? Math.max(this.conversationPage, data.page) : data.page;
          this.conversationPages = data.pages;
          if (page === 1 && !refresh) this.conversations.set(data.items);
          else if (page === 1)
            this.conversations.set(this.mergeConversations(data.items, this.conversations()));
          else this.conversations.set(this.mergeConversations(this.conversations(), data.items));
          const selected = this.selectedConversation();
          if (selected) {
            const updated = data.items.find((item) => item.id === selected.id);
            if (updated) {
              this.selectedConversation.set(updated);
              this.ensureTemplatesFor(updated);
            }
          } else if (!this.isMobile() && data.items[0]) {
            this.selectConversation(data.items[0]);
          }
        },
        error: (error: unknown) => {
          if (this.isCurrentChannel(epoch, provider)) {
            this.conversationError.set(
              this.errorMessage(error, 'Unable to load WhatsApp conversations.'),
            );
          }
        },
      });
  }

  private loadMessages(conversationId: string, page: number, refresh: boolean): void {
    if (this.messageRequestActive) {
      if (!refresh) this.pendingMessageLoad = { conversationId, page, refresh };
      return;
    }
    const provider = this.selectedProvider();
    const epoch = this.channelEpoch;
    this.messageRequestActive = true;
    if (!refresh && page === 1) this.loadingMessages.set(true);
    if (!refresh && page > 1) this.loadingOlderMessages.set(true);
    this.messageError.set('');

    this.listMessagesRequest(provider, conversationId, page)
      .pipe(
        finalize(() => {
          if (!this.isCurrentChannel(epoch, provider)) return;
          this.messageRequestActive = false;
          this.loadingMessages.set(false);
          this.loadingOlderMessages.set(false);
          const pending = this.pendingMessageLoad;
          this.pendingMessageLoad = null;
          if (pending)
            queueMicrotask(() =>
              this.loadMessages(pending.conversationId, pending.page, pending.refresh),
            );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          if (
            !this.isCurrentChannel(epoch, provider) ||
            this.selectedConversation()?.id !== conversationId
          )
            return;
          this.messagePage = Math.max(this.messagePage, data.page);
          this.messagePages = data.pages;
          this.messages.set(this.mergeMessages(this.messages(), data.items));
          this.updateConversation(data.conversation);
          this.ensureTemplatesFor(data.conversation);
          this.markSelectedRead();
        },
        error: (error: unknown) => {
          if (
            this.isCurrentChannel(epoch, provider) &&
            this.selectedConversation()?.id === conversationId
          ) {
            this.messageError.set(this.errorMessage(error, 'Unable to load WhatsApp messages.'));
          }
        },
      });
  }

  private submitSend(pending: PendingSend): void {
    this.sendingContextKey.set(pending.contextKey);
    this.clearFeedback(pending.contextKey);
    const send$ =
      pending.provider === 'meta'
        ? this.meta
            .send(pending.request as MetaWhatsAppSendRequest)
            .pipe(
              map(({ data }) => ({ ...data, message: this.normalizeMetaMessage(data.message) })),
            )
        : this.twilio
            .reply(pending.conversationId, pending.request as WhatsAppReplyRequest)
            .pipe(map(({ data }) => data));
    send$
      .pipe(
        finalize(() => {
          if (this.sendingContextKey() === pending.contextKey) this.sendingContextKey.set(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (data) => {
          this.reconcileMessage(pending.provider, data.message);
          if (data.message.status === 'unknown' || data.operation_state === 'in_progress') {
            this.patchRecord(this.uncertainSends, pending.contextKey, true);
            this.patchRecord(
              this.sendErrors,
              pending.contextKey,
              'The original send outcome is still uncertain. It was not retried; use Check Result later.',
            );
            return;
          }
          if (data.message.status === 'failed' || data.message.status === 'undelivered') {
            this.finishDefinitiveFailure(
              pending,
              data.message.failure_reason || 'The provider rejected the message.',
            );
            return;
          }
          this.completePendingSend(pending);
          this.patchRecord(
            this.sendNotices,
            pending.contextKey,
            data.replayed
              ? 'The existing send result was recovered. No duplicate was sent.'
              : 'Accepted by the provider. Delivery and read status will update separately.',
          );
          this.refreshConversationList();
        },
        error: (error: unknown) => {
          const failure = whatsappSendFailure(error);
          this.patchRecord(this.sendErrors, pending.contextKey, failure.message);
          if (failure.uncertain) this.patchRecord(this.uncertainSends, pending.contextKey, true);
          else {
            this.removeRecord(this.pendingSends, pending.contextKey);
            this.patchRecord(this.uncertainSends, pending.contextKey, false);
            this.recheckEligibility(pending);
          }
        },
      });
  }

  private handleRecovery(pending: PendingSend, data: WhatsAppRecoveryResult): void {
    if (data.idempotency_key !== pending.request.idempotency_key) {
      this.patchRecord(
        this.sendErrors,
        pending.contextKey,
        'The recovery response did not match the original request. No new message was sent.',
      );
      return;
    }
    if (!data.found || !data.message) {
      this.patchRecord(
        this.sendErrors,
        pending.contextKey,
        'The original result is still unknown. No message was resent; use Check Result again later.',
      );
      return;
    }
    this.reconcileMessage(pending.provider, data.message);
    if (data.operation_state === 'in_progress' || data.message.status === 'unknown') {
      this.patchRecord(
        this.sendErrors,
        pending.contextKey,
        'The original send is still processing or uncertain. It was not resent; check again later.',
      );
      return;
    }
    if (data.message.status === 'failed' || data.message.status === 'undelivered') {
      this.finishDefinitiveFailure(
        pending,
        data.message.failure_reason || 'The provider rejected the message.',
      );
      return;
    }
    this.completePendingSend(pending);
    this.patchRecord(
      this.sendNotices,
      pending.contextKey,
      'The original send result was recovered. No duplicate was sent.',
    );
    this.refreshConversationList();
  }

  private completePendingSend(pending: PendingSend): void {
    if (
      pending.textSnapshot !== null &&
      this.drafts()[pending.contextKey] === pending.textSnapshot
    ) {
      this.patchRecord(this.drafts, pending.contextKey, '');
    }
    if (
      pending.provider === 'meta' &&
      (pending.request as MetaWhatsAppSendRequest).mode === 'approved_template'
    ) {
      this.saveTemplateDraft(
        { ...this.templateDrafts()[pending.contextKey], variables: {} },
        pending.contextKey,
      );
    }
    this.removeRecord(this.pendingSends, pending.contextKey);
    this.patchRecord(this.uncertainSends, pending.contextKey, false);
    this.patchRecord(this.sendErrors, pending.contextKey, '');
  }

  private finishDefinitiveFailure(pending: PendingSend, reason: string): void {
    this.removeRecord(this.pendingSends, pending.contextKey);
    this.patchRecord(this.uncertainSends, pending.contextKey, false);
    this.patchRecord(this.sendErrors, pending.contextKey, reason);
    this.recheckEligibility(pending);
  }

  private recheckEligibility(pending: PendingSend): void {
    if (
      pending.provider === 'meta' &&
      this.selectedProvider() === 'meta' &&
      this.selectedConversation()?.id === pending.conversationId
    ) {
      this.loadMessages(pending.conversationId, 1, true);
    }
  }

  private loadTemplates(page: number, accumulated: readonly MetaApprovedTemplate[]): void {
    if (page === 1) {
      this.templatesLoading.set(true);
      this.templatesError.set('');
    }
    const epoch = this.channelEpoch;
    this.meta
      .listTemplates(page, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          if (!this.isCurrentChannel(epoch, 'meta')) return;
          const approved = [...accumulated, ...data.items].filter(
            (item) => item.usable && item.provider_status.toUpperCase() === 'APPROVED',
          );
          if (data.page < data.pages) {
            this.loadTemplates(data.page + 1, approved);
            return;
          }
          this.templatesLoading.set(false);
          this.approvedTemplates.set(approved);
          this.ensureCurrentTemplateSelection();
        },
        error: (error: unknown) => {
          if (this.isCurrentChannel(epoch, 'meta')) {
            this.templatesLoading.set(false);
            this.templatesError.set(
              this.errorMessage(error, 'Unable to load approved Meta WhatsApp templates.'),
            );
          }
        },
      });
  }

  private ensureTemplatesFor(conversation: WhatsAppConversation): void {
    if (this.selectedProvider() !== 'meta' || conversation.free_form_reply_allowed) return;
    if (!this.approvedTemplates().length && !this.templatesLoading()) this.loadTemplates(1, []);
    else this.ensureCurrentTemplateSelection();
  }

  private ensureCurrentTemplateSelection(): void {
    const key = this.currentContextKey();
    const first = this.approvedTemplates()[0];
    if (!key || !first || this.templateDrafts()[key]?.name) return;
    this.saveTemplateDraft({
      name: first.name,
      language: first.language,
      variables: {},
      purpose: this.selectedConversation()?.customer_id ? 'customer_service' : 'lead_acquisition',
    });
  }

  private saveTemplateDraft(draft: TemplateDraft, key = this.currentContextKey()): void {
    if (!key || !draft) return;
    this.patchRecord(this.templateDrafts, key, draft);
    this.clearFeedback(key);
  }

  private loadLinkOptions(): void {
    this.loadRecordOptions(
      this.linkType(),
      this.linkSearch.value.trim(),
      this.loadingLinkOptions,
      this.linkOptions,
      this.linkError,
    );
  }

  private loadNewChatOptions(): void {
    this.loadRecordOptions(
      this.newChatLinkType(),
      this.newChatSearch.value.trim(),
      this.loadingNewChatOptions,
      this.newChatOptions,
      this.newChatError,
    );
  }

  private loadRecordOptions(
    type: 'lead' | 'customer',
    search: string,
    loading: { set: (value: boolean) => void },
    options: { set: (value: readonly LinkOption[]) => void },
    errorSignal: { set: (value: string) => void },
  ): void {
    loading.set(true);
    errorSignal.set('');
    if (type === 'lead') {
      this.leads
        .list(1, 50, { search })
        .pipe(
          finalize(() => loading.set(false)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe({
          next: ({ data }) =>
            options.set(
              data.items.map((item) => ({
                id: item.id,
                label: `${item.first_name} ${item.last_name}`.trim() || item.email,
                subtitle: `${item.tracking_id} · ${item.email}`,
              })),
            ),
          error: (error: unknown) => this.handleRecordOptionsError(error, options, errorSignal),
        });
      return;
    }
    this.customers
      .list(1, 50, search)
      .pipe(
        finalize(() => loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) =>
          options.set(
            data.items.map((item) => ({
              id: item.id,
              label: `${item.first_name} ${item.last_name}`.trim() || item.email,
              subtitle: item.email,
            })),
          ),
        error: (error: unknown) => this.handleRecordOptionsError(error, options, errorSignal),
      });
  }

  private handleRecordOptionsError(
    error: unknown,
    options: { set: (value: readonly LinkOption[]) => void },
    errorSignal: { set: (value: string) => void },
  ): void {
    options.set([]);
    errorSignal.set(this.errorMessage(error, 'Unable to load accessible records.'));
  }

  private linkOpenedConversation(
    conversation: WhatsAppConversation,
    request: WhatsAppConversationLinkRequest,
    epoch: number,
  ): void {
    this.linking.set(true);
    this.meta
      .link(conversation.id, request)
      .pipe(
        finalize(() => {
          if (epoch === this.channelEpoch) this.linking.set(false);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          if (this.isCurrentChannel(epoch, 'meta'))
            this.updateConversation(this.normalizeMetaConversation(data));
          this.restoreDialogFocus();
        },
        error: (error: unknown) => {
          const key = this.contextKey('meta', conversation.id);
          this.patchRecord(
            this.sendErrors,
            key,
            `${this.errorMessage(error, 'The conversation opened, but the selected record could not be linked.')} No message was sent.`,
          );
          this.restoreDialogFocus();
        },
      });
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      if (!this.auth.isAuthenticated()) return;
      if (this.document.visibilityState === 'hidden') {
        const now = Date.now();
        if (now - this.lastHiddenPollAt < HIDDEN_POLL_INTERVAL_MS) return;
        this.lastHiddenPollAt = now;
      }
      this.pollNow();
    }, POLL_INTERVAL_MS);
  }

  private pollNow(): void {
    this.refreshConversationList();
    const selected = this.selectedConversation();
    if (selected && (!this.isMobile() || this.mobileChatOpen()))
      this.loadMessages(selected.id, 1, true);
  }

  private refreshConversationList(): void {
    this.loadConversations(1, true);
  }

  private markSelectedRead(): void {
    const selected = this.selectedConversation();
    const provider = this.selectedProvider();
    if (
      !selected ||
      selected.unread_count <= 0 ||
      this.document.visibilityState !== 'visible' ||
      (this.isMobile() && !this.mobileChatOpen())
    )
      return;
    const key = this.contextKey(provider, selected.id);
    if (this.readRequests.has(key)) return;
    this.readRequests.add(key);
    this.markReadRequest(provider, selected.id)
      .pipe(
        finalize(() => this.readRequests.delete(key)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          if (this.selectedProvider() === provider)
            this.updateConversation({ ...selected, unread_count: 0 });
        },
        error: () => undefined,
      });
  }

  private listConversationsRequest(
    provider: WhatsAppProvider,
    page: number,
    search: string,
  ): Observable<ApiDataResponse<WhatsAppConversationPage>> {
    if (provider === 'twilio') {
      return this.twilio.listConversations(page, WHATSAPP_CONVERSATION_PAGE_SIZE, search).pipe(
        map((response) => ({
          ...response,
          data: {
            ...response.data,
            items: response.data.items.map((item) => this.normalizeTwilioConversation(item)),
          },
        })),
      );
    }
    return this.meta.listConversations(page, WHATSAPP_CONVERSATION_PAGE_SIZE, search).pipe(
      map((response) => ({
        ...response,
        data: {
          ...response.data,
          items: response.data.items.map((item) => this.normalizeMetaConversation(item)),
        },
      })),
    );
  }

  private listMessagesRequest(
    provider: WhatsAppProvider,
    conversationId: string,
    page: number,
  ): Observable<ApiDataResponse<WhatsAppMessagePage>> {
    if (provider === 'twilio') {
      return this.twilio.listMessages(conversationId, page, WHATSAPP_MESSAGE_PAGE_SIZE).pipe(
        map((response) => ({
          ...response,
          data: {
            ...response.data,
            conversation: this.normalizeTwilioConversation(response.data.conversation),
            items: response.data.items.map((item) => ({ ...item, provider: 'twilio' as const })),
          },
        })),
      );
    }
    return this.meta.listMessages(conversationId, page, WHATSAPP_MESSAGE_PAGE_SIZE).pipe(
      map((response) => ({
        ...response,
        data: {
          ...response.data,
          conversation: this.normalizeMetaConversation(response.data.conversation),
          items: response.data.items.map((item) => this.normalizeMetaMessage(item)),
        },
      })),
    );
  }

  private markReadRequest(provider: WhatsAppProvider, conversationId: string): Observable<unknown> {
    return provider === 'meta'
      ? this.meta.markRead(conversationId)
      : this.twilio.markRead(conversationId);
  }

  private linkConversationRequest(
    provider: WhatsAppProvider,
    conversationId: string,
    request: WhatsAppConversationLinkRequest,
  ): Observable<WhatsAppConversation> {
    return provider === 'meta'
      ? this.meta
          .link(conversationId, request)
          .pipe(map(({ data }) => this.normalizeMetaConversation(data)))
      : this.twilio
          .link(conversationId, request)
          .pipe(map(({ data }) => this.normalizeTwilioConversation(data)));
  }

  private normalizeTwilioConversation(conversation: WhatsAppConversation): WhatsAppConversation {
    return {
      ...conversation,
      provider: 'twilio',
      eligibility: {
        free_form_allowed: conversation.free_form_reply_allowed,
        service_window_expires_at: conversation.service_window_expires_at,
        approved_template_required: !conversation.free_form_reply_allowed,
        template_outreach_allowed: false,
        restrictions: [],
      },
    };
  }

  private normalizeMetaConversation(conversation: MetaWhatsAppConversation): WhatsAppConversation {
    return {
      id: conversation.id,
      external_address: conversation.external_address,
      lead_id: conversation.lead_id,
      customer_id: conversation.customer_id,
      contact_name: conversation.contact_name,
      last_message_at: conversation.last_message_at,
      last_message_preview: conversation.last_message_preview,
      unread_count: conversation.unread_count,
      free_form_reply_allowed: conversation.eligibility.free_form_allowed,
      service_window_expires_at: conversation.eligibility.service_window_expires_at,
      provider: 'meta',
      eligibility: conversation.eligibility,
    };
  }

  private normalizeMetaMessage(message: MetaWhatsAppMessage): WhatsAppMessage {
    return {
      id: message.id,
      conversation_id: message.conversation_id,
      direction: message.direction,
      body: message.body,
      media: message.media.map((media, index) => ({
        index,
        content_type: media.type,
        unsupported: media.unsupported,
      })),
      status: message.status,
      provider_message_sid: message.provider_message_id,
      provider_message_id: message.provider_message_id,
      provider_error_code: message.provider_error_code,
      failure_reason: message.failure_reason,
      requested_by_user_id: message.requested_by_user_id,
      occurred_at: message.occurred_at,
      completed_at: message.completed_at,
      provider: 'meta',
      mode: message.mode,
      purpose: message.purpose,
    };
  }

  private normalizeMetaRecovery(data: MetaWhatsAppRecoveryResult): WhatsAppRecoveryResult {
    return { ...data, message: data.message ? this.normalizeMetaMessage(data.message) : null };
  }

  private updateConversation(conversation: WhatsAppConversation): void {
    this.conversations.update((items) =>
      items.map((item) => (item.id === conversation.id ? { ...item, ...conversation } : item)),
    );
    if (this.selectedConversation()?.id === conversation.id)
      this.selectedConversation.set({ ...this.selectedConversation()!, ...conversation });
  }

  private reconcileMessage(provider: WhatsAppProvider, message: WhatsAppMessage): void {
    if (
      this.selectedProvider() !== provider ||
      this.selectedConversation()?.id !== message.conversation_id
    )
      return;
    this.messages.set(this.mergeMessages(this.messages(), [message]));
  }

  private mergeConversations(
    first: readonly WhatsAppConversation[],
    second: readonly WhatsAppConversation[],
  ): WhatsAppConversation[] {
    const byId = new Map<string, WhatsAppConversation>();
    for (const item of [...first, ...second]) byId.set(item.id, item);
    return Array.from(byId.values()).sort(
      (a, b) =>
        Date.parse(b.last_message_at) - Date.parse(a.last_message_at) || b.id.localeCompare(a.id),
    );
  }

  private mergeMessages(
    current: readonly WhatsAppMessage[],
    incoming: readonly WhatsAppMessage[],
  ): WhatsAppMessage[] {
    const byId = new Map(current.map((message) => [message.id, message]));
    for (const message of incoming) byId.set(message.id, message);
    return Array.from(byId.values()).sort(
      (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.id.localeCompare(b.id),
    );
  }

  private resetVisibleInbox(): void {
    this.conversations.set([]);
    this.selectedConversation.set(null);
    this.messages.set([]);
    this.conversationPage = 1;
    this.conversationPages = 0;
    this.messagePage = 1;
    this.messagePages = 0;
    this.conversationRequestActive = false;
    this.messageRequestActive = false;
    this.pendingConversationLoad = null;
    this.pendingMessageLoad = null;
    this.loadingConversations.set(true);
    this.loadingMessages.set(false);
    this.refreshingConversations.set(false);
    this.loadingMoreConversations.set(false);
    this.loadingOlderMessages.set(false);
    this.conversationError.set('');
    this.messageError.set('');
    this.mobileChatOpen.set(false);
  }

  private clearFeedback(key: string): void {
    this.patchRecord(this.sendErrors, key, '');
    this.patchRecord(this.sendNotices, key, '');
  }

  private contextKey(provider: WhatsAppProvider, conversationId: string): string {
    return `${provider}:${conversationId}`;
  }

  private variableKey(component: string, index: number): string {
    return `${component}:${index}`;
  }

  private linkRequest(type: 'lead' | 'customer', id: string): WhatsAppConversationLinkRequest {
    return type === 'lead' ? { lead_id: id } : { customer_id: id };
  }

  private isCurrentChannel(epoch: number, provider: WhatsAppProvider): boolean {
    return epoch === this.channelEpoch && provider === this.selectedProvider();
  }

  private activeDialog(): HTMLElement | undefined {
    return this.newChatOpen()
      ? this.newChatDialog?.nativeElement
      : this.linkOpen()
        ? this.linkDialog?.nativeElement
        : undefined;
  }

  private rememberDialogOpener(): void {
    this.dialogOpener =
      this.document.activeElement instanceof HTMLElement ? this.document.activeElement : null;
  }

  private focusDialog(dialog: ElementRef<HTMLElement> | undefined, selector: string): void {
    if (this.isBrowser)
      setTimeout(() => dialog?.nativeElement.querySelector<HTMLElement>(selector)?.focus());
  }

  private restoreDialogFocus(): void {
    if (this.isBrowser) setTimeout(() => this.dialogOpener?.focus());
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

  private createIdempotencyKey(provider: WhatsAppProvider): string {
    const id = globalThis.crypto?.randomUUID?.();
    return id
      ? `${provider}-wa-${id}`
      : `${provider}-wa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.status === 403)
      return 'You do not have permission to perform this WhatsApp action in the current workspace.';
    return leadErrorDetails(error, fallback).message;
  }
}
