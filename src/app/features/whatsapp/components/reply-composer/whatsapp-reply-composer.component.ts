import { Component, EventEmitter, Input, Output } from '@angular/core';

import { MetaApprovedTemplate, MetaWhatsAppPurpose } from '../../models/meta-whatsapp.models';
import { WHATSAPP_REPLY_MAX_CHARACTERS } from '../../models/whatsapp.models';
import { WhatsAppEligibility, WhatsAppProvider } from '../../models/whatsapp.models';

@Component({
  selector: 'app-whatsapp-reply-composer',
  imports: [],
  templateUrl: './whatsapp-reply-composer.component.html',
  styleUrl: './whatsapp-reply-composer.component.css',
})
export class WhatsAppReplyComposerComponent {
  @Input() draft = '';
  @Input() canSend = false;
  @Input() serviceWindowOpen = false;
  @Input() provider: WhatsAppProvider = 'twilio';
  @Input() eligibility: WhatsAppEligibility | null = null;
  @Input() templates: readonly MetaApprovedTemplate[] = [];
  @Input() templatesLoading = false;
  @Input() templatesError = '';
  @Input() templateName = '';
  @Input() templateLanguage = '';
  @Input() templateVariables: Readonly<Record<string, string>> = {};
  @Input() purpose: MetaWhatsAppPurpose = 'lead_acquisition';
  @Input() sending = false;
  @Input() checkingResult = false;
  @Input() uncertain = false;
  @Input() errorMessage = '';
  @Input() notice = '';
  @Output() readonly draftChange = new EventEmitter<string>();
  @Output() readonly send = new EventEmitter<void>();
  @Output() readonly checkResult = new EventEmitter<void>();
  @Output() readonly templateNameChange = new EventEmitter<string>();
  @Output() readonly templateLanguageChange = new EventEmitter<string>();
  @Output() readonly templateVariableChange = new EventEmitter<{ key: string; value: string }>();
  @Output() readonly purposeChange = new EventEmitter<MetaWhatsAppPurpose>();
  @Output() readonly retryTemplates = new EventEmitter<void>();

  protected readonly maxCharacters = WHATSAPP_REPLY_MAX_CHARACTERS;

  protected templateMode(): boolean {
    return this.provider === 'meta' && !this.serviceWindowOpen;
  }

  protected templateNames(): string[] {
    return Array.from(new Set(this.templates.map((template) => template.name))).sort();
  }

  protected templateLanguages(): string[] {
    return Array.from(
      new Set(
        this.templates
          .filter((template) => template.name === this.templateName)
          .map((template) => template.language),
      ),
    ).sort();
  }

  protected selectedTemplate(): MetaApprovedTemplate | undefined {
    return this.templates.find(
      (template) =>
        template.name === this.templateName && template.language === this.templateLanguage,
    );
  }

  protected variableKey(component: string, index: number): string {
    return `${component}:${index}`;
  }

  protected templateSummary(): string {
    const template = this.selectedTemplate();
    if (!template) return '';
    return template.components
      .map((component) => {
        const type = String(component['type'] ?? '').toLowerCase();
        const text = component['text'];
        if (typeof text !== 'string') return '';
        return text.replace(/\{\{(\d+)\}\}/g, (_match, index: string) => {
          const value = this.templateVariables[this.variableKey(type, Number(index))];
          return value?.trim() ? value : `{{${index}}}`;
        });
      })
      .filter(Boolean)
      .join('\n');
  }

  protected changePurpose(value: string): void {
    this.purposeChange.emit(value === 'customer_service' ? 'customer_service' : 'lead_acquisition');
  }

  protected updateDraft(value: string): void {
    this.draftChange.emit(value);
  }

  protected submit(): void {
    if (this.disabled()) return;
    this.send.emit();
  }

  protected disabled(): boolean {
    if (this.templateMode()) {
      const template = this.selectedTemplate();
      const missingVariable = template?.required_variables.some(
        (variable) =>
          !this.templateVariables[this.variableKey(variable.component, variable.index)]?.trim(),
      );
      return (
        !this.canSend ||
        this.sending ||
        this.checkingResult ||
        this.uncertain ||
        !this.eligibility?.template_outreach_allowed ||
        !template ||
        Boolean(missingVariable)
      );
    }
    return (
      !this.canSend ||
      !this.serviceWindowOpen ||
      this.sending ||
      this.checkingResult ||
      this.uncertain ||
      !this.draft.trim() ||
      this.draft.length > this.maxCharacters
    );
  }
}
