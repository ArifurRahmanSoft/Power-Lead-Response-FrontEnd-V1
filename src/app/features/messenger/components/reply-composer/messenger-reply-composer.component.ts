import { Component, EventEmitter, Input, Output } from '@angular/core';

import {
  MESSENGER_REPLY_MAX_CHARACTERS,
  MessengerEligibility,
} from '../../models/messenger.models';

@Component({
  selector: 'app-messenger-reply-composer',
  imports: [],
  templateUrl: './messenger-reply-composer.component.html',
  styleUrl: './messenger-reply-composer.component.css',
})
export class MessengerReplyComposerComponent {
  @Input() draft = '';
  @Input() canSend = false;
  @Input() eligibility: MessengerEligibility | null = null;
  @Input() replyWindowOpen = false;
  @Input() sending = false;
  @Input() checkingResult = false;
  @Input() uncertain = false;
  @Input() errorMessage = '';
  @Input() notice = '';
  @Output() readonly draftChange = new EventEmitter<string>();
  @Output() readonly send = new EventEmitter<void>();
  @Output() readonly checkResult = new EventEmitter<void>();

  protected readonly maxCharacters = MESSENGER_REPLY_MAX_CHARACTERS;

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
      this.draft.length > this.maxCharacters
    );
  }
}
