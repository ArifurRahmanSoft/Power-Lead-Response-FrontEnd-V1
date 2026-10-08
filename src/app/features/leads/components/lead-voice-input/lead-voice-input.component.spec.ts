import { TestBed } from '@angular/core/testing';

import { LeadVoiceExtractResponse, LeadVoiceFormValues } from '../../models/lead-voice.models';
import { LeadVoiceService } from '../../services/lead-voice.service';
import { LeadVoiceInputComponent } from './lead-voice-input.component';

const response: LeadVoiceExtractResponse = {
  transcript: 'Jane Doe, corrected email jane@example.com',
  extracted_fields: {
    first_name: 'Jane',
    last_name: 'Doe',
    email: null,
    phone: '01712345678',
    country: null,
    designation: null,
    company: null,
    city: null,
    state: null,
    company_website: null,
    industry: null,
    company_size: null,
    revenue_amount: null,
    revenue_currency: null,
    revenue_period: null,
    linkedin_url: null,
    facebook_url: null,
    instagram_url: null,
    x_url: null,
    github_url: null,
    service_requested: null,
    notes: null,
  },
  field_errors: [{ field: 'email', message: 'Email is invalid' }],
  review_warnings: ['Confirm the full-name split.'],
};

describe('LeadVoiceInputComponent review', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LeadVoiceInputComponent],
      providers: [{ provide: LeadVoiceService, useValue: { extract: vi.fn() } }],
    });
  });

  it('shows backend review feedback and emits corrected nonblank fields only', () => {
    const fixture = TestBed.createComponent(LeadVoiceInputComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      loadReview(value: LeadVoiceExtractResponse): void;
      fieldError(field: 'email'): string;
      requestApply(): void;
      reviewForm: {
        controls: Record<
          string,
          { setValue(value: string): void; markAsDirty(): void; value: string }
        >;
      };
      applyDraft: { subscribe(callback: (value: LeadVoiceFormValues) => void): void };
    };
    let applied: LeadVoiceFormValues | undefined;
    component.applyDraft.subscribe((value) => (applied = value));

    component.loadReview(response);
    expect(component.fieldError('email')).toBe('Email is invalid');
    component.reviewForm.controls['email'].setValue('jane@example.com');
    component.reviewForm.controls['email'].markAsDirty();
    expect(component.fieldError('email')).toBe('');

    component.requestApply();
    expect(applied).toEqual({
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      phone: '01712345678',
    });
  });
});
