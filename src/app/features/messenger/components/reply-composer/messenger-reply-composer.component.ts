import { Component, EventEmitter, Input, Output } from '@angular/core';

import { MessagingEligibilityView } from '../../../messages/models/messaging-view.models';

@Component({
  selector: 'app-messenger-reply-composer',
  imports: [],
  templateUrl: './messenger-reply-composer.component.html',
  styleUrl: './messenger-reply-composer.component.css',
})
export class MessengerReplyComposerComponent {
  @Input() draft = '';
  @Input() channelLabel = 'Messenger';
  @Input() maxCharacters = 2_000;
  @Input() maxUtf8Bytes: number | null = null;
  @Input() canSend = false;
  @Input() disabledReason = '';
  @Input() eligibility: MessagingEligibilityView | null = null;
  @Input() replyWindowOpen = false;
  @Input() sending = false;
  @Input() checkingResult = false;
  @Input() uncertain = false;
  @Input() errorMessage = '';
  @Input() notice = '';
  @Output() readonly draftChange = new EventEmitter<string>();
  @Output() readonly send = new EventEmitter<void>();
  @Output() readonly checkResult = new EventEmitter<void>();

  protected utf8Bytes(value = this.draft): number {
    return new TextEncoder().encode(value).length;
  }

  protected updateDraft(value: string): void {
    this.draftChange.emit(value);
  }

  protected submit(): void {
    if (!this.disabled()) this.send.emit();
  }

  protected disabled(): boolean {
    return (
      !this.canSend ||
      !this.replyWindowOpen ||
      this.sending ||
      this.checkingResult ||
      this.uncertain ||
      !this.draft.trim() ||
      this.draft.length > this.maxCharacters ||
      (this.maxUtf8Bytes !== null && this.utf8Bytes() > this.maxUtf8Bytes)
    );
  }
}
