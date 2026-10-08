import { Injectable, OnDestroy } from '@angular/core';

import {
  LeadVoiceRecording,
  LeadVoiceRecordingError,
  LeadVoiceRecordingErrorCode,
} from '../models/lead-voice.models';

const SUPPORTED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
] as const;

@Injectable()
export class LeadVoiceRecordingService implements OnDestroy {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  isSupported(): boolean {
    return Boolean(
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined',
    );
  }

  async start(): Promise<void> {
    this.cancel();
    if (typeof window === 'undefined' || !window.isSecureContext) {
      throw new LeadVoiceRecordingError(
        'insecure',
        'Microphone access requires localhost or a secure HTTPS connection.',
      );
    }
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      throw new LeadVoiceRecordingError(
        'unsupported',
        'This browser does not support microphone recording.',
      );
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = SUPPORTED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) {
        this.releaseTracks();
        throw new LeadVoiceRecordingError(
          'unsupported',
          'This browser cannot record a backend-supported audio format.',
        );
      }
      this.recorder = new MediaRecorder(this.stream, { mimeType, audioBitsPerSecond: 128_000 });
      this.chunks = [];
      this.recorder.ondataavailable = (event) => {
        if (event.data.size) this.chunks.push(event.data);
      };
      this.recorder.start(1_000);
    } catch (error: unknown) {
      this.releaseTracks();
      throw this.mapError(error);
    }
  }

  stop(): Promise<LeadVoiceRecording> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      return Promise.reject(
        new LeadVoiceRecordingError('recording-failed', 'No active recording is available.'),
      );
    }

    return new Promise<LeadVoiceRecording>((resolve, reject) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || this.chunks[0]?.type || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        this.recorder = null;
        this.chunks = [];
        this.releaseTracks();
        if (!blob.size) {
          reject(
            new LeadVoiceRecordingError(
              'recording-failed',
              'The recording was empty. Please try again.',
            ),
          );
          return;
        }
        resolve({ blob, mimeType, filename: `lead-voice.${this.extensionFor(mimeType)}` });
      };
      recorder.onerror = (event) => {
        this.recorder = null;
        this.chunks = [];
        this.releaseTracks();
        reject(this.mapError(event));
      };
      recorder.stop();
    });
  }

  cancel(): void {
    const recorder = this.recorder;
    this.recorder = null;
    this.chunks = [];
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      recorder.stop();
    }
    this.releaseTracks();
  }

  ngOnDestroy(): void {
    this.cancel();
  }

  private releaseTracks(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private extensionFor(mimeType: string): string {
    const baseType = mimeType.split(';', 1)[0].toLowerCase();
    if (baseType.includes('ogg')) return 'ogg';
    if (baseType.includes('mp4')) return 'm4a';
    return 'webm';
  }

  private mapError(error: unknown): LeadVoiceRecordingError {
    if (error instanceof LeadVoiceRecordingError) return error;
    const name = error instanceof DOMException ? error.name : '';
    const mapped: Record<string, [LeadVoiceRecordingErrorCode, string]> = {
      NotAllowedError: [
        'permission-denied',
        'Microphone permission was denied. Allow access in your browser and try again.',
      ],
      SecurityError: [
        'permission-denied',
        'Microphone access is blocked by the browser or page permissions.',
      ],
      NotFoundError: ['device-not-found', 'No microphone was found on this device.'],
      DevicesNotFoundError: ['device-not-found', 'No microphone was found on this device.'],
      NotReadableError: [
        'device-unavailable',
        'The microphone is unavailable or already in use by another application.',
      ],
      TrackStartError: [
        'device-unavailable',
        'The microphone is unavailable or already in use by another application.',
      ],
    };
    const [code, message] = mapped[name] || [
      'recording-failed',
      'The recording could not be started. Please check your microphone and try again.',
    ];
    return new LeadVoiceRecordingError(code, message);
  }
}
