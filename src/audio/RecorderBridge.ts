export interface CaptureAudio {
  start(): Promise<void>;
  stop(): Promise<void>;
  onAudio(listener: (frame: { data: Uint8Array }) => void): () => void;
}

export interface ASRWriter {
  write(data: Uint8Array): void;
}

export class RecorderBridge {
  #session: ASRWriter | null = null;

  constructor(private readonly audio: CaptureAudio) {
    audio.onAudio((frame) => {
      if (!this.#session) return;
      this.#session.write(frame.data);
    });
  }

  async start(session: ASRWriter): Promise<void> {
    this.#session = session;
    await this.audio.start();
  }

  async stop(): Promise<void> {
    await this.audio.stop();
    this.#session = null;
  }
}
