import { LeadVoiceRecordingService } from './lead-voice-recording.service';

class FakeMediaRecorder {
  static isTypeSupported(type: string): boolean {
    return type.startsWith('audio/webm');
  }

  readonly mimeType: string;
  state: RecordingState = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(
    readonly stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    this.mimeType = options?.mimeType || 'audio/webm';
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    const data = new Blob(['recorded voice'], { type: this.mimeType });
    this.ondataavailable?.({ data } as BlobEvent);
    this.onstop?.(new Event('stop'));
  }
}

describe('LeadVoiceRecordingService', () => {
  const originalSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalSecureContext)
      Object.defineProperty(window, 'isSecureContext', originalSecureContext);
    if (originalMediaDevices)
      Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  });

  it('records a supported WebM blob and releases microphone tracks on stop', async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const service = new LeadVoiceRecordingService();
    expect(service.isSupported()).toBe(true);
    await service.start();
    const recording = await service.stop();

    expect(recording.mimeType).toBe('audio/webm;codecs=opus');
    expect(recording.filename).toBe('lead-voice.webm');
    expect(recording.blob.size).toBeGreaterThan(0);
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it('reports microphone denial with a user-facing error code', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError')),
      },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const service = new LeadVoiceRecordingService();
    await expect(service.start()).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('releases microphone tracks when a recording is cancelled', async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const service = new LeadVoiceRecordingService();
    await service.start();
    service.cancel();

    expect(stopTrack).toHaveBeenCalledOnce();
  });
});
