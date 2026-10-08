import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api.config';
import { LeadVoiceExtractResponse, LeadVoiceRecording } from '../models/lead-voice.models';

@Injectable({ providedIn: 'root' })
export class LeadVoiceService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${API_CONFIG.baseUrl}/leads/voice-extract`;

  extract(recording: LeadVoiceRecording): Observable<LeadVoiceExtractResponse> {
    const body = new FormData();
    body.append('audio', recording.blob, recording.filename);
    return this.http.post<LeadVoiceExtractResponse>(this.endpoint, body);
  }
}
