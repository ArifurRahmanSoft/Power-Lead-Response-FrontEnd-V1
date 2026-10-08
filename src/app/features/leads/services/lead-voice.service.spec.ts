import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_CONFIG } from '../../../core/config/api.config';
import { LeadVoiceService } from './lead-voice.service';

describe('LeadVoiceService', () => {
  let service: LeadVoiceService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [LeadVoiceService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(LeadVoiceService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uploads audio as multipart form data without setting Content-Type', () => {
    const blob = new Blob(['voice'], { type: 'audio/webm;codecs=opus' });
    service.extract({ blob, mimeType: blob.type, filename: 'lead-voice.webm' }).subscribe();

    const request = http.expectOne(`${API_CONFIG.baseUrl}/leads/voice-extract`);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.has('Content-Type')).toBe(false);
    expect(request.request.body instanceof FormData).toBe(true);
    const audio = (request.request.body as FormData).get('audio') as File;
    expect(audio.name).toBe('lead-voice.webm');
    expect(audio.type).toBe('audio/webm;codecs=opus');
    expect(audio.size).toBe(blob.size);
    request.flush({
      transcript: 'Jane Doe',
      extracted_fields: {},
      field_errors: [],
      review_warnings: [],
    });
  });
});
