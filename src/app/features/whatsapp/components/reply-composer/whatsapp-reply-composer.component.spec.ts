import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WhatsAppReplyComposerComponent } from './whatsapp-reply-composer.component';

describe('WhatsAppReplyComposerComponent', () => {
  let fixture: ComponentFixture<WhatsAppReplyComposerComponent>;
  let component: WhatsAppReplyComposerComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WhatsAppReplyComposerComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(WhatsAppReplyComposerComponent);
    component = fixture.componentInstance;
  });

  it('keeps sending controls disabled without messages.send permission', () => {
    component.draft = 'Not authorized';
    component.canSend = false;
    component.serviceWindowOpen = true;
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('.send-button')?.disabled).toBe(true);
    expect(root.textContent).toContain('do not have permission');
  });

  it('keeps the textarea multiline and exposes the backend character limit', () => {
    component.draft = 'বাংলা\nSecond line';
    component.canSend = true;
    component.serviceWindowOpen = true;
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector<HTMLTextAreaElement>('textarea')?.rows).toBe(2);
    expect(root.querySelector<HTMLTextAreaElement>('textarea')?.maxLength).toBe(1600);
    expect(root.textContent).toContain('/ 1600');
  });
});
