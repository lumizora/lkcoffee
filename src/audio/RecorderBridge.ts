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
  #chunks: Uint8Array[] = [];

  constructor(private readonly audio: CaptureAudio) {
    audio.onAudio((frame) => {
      if (!this.#session) return;
      const data = frame.data.slice();
      this.#chunks.push(data);
      this.#session.write(data);
    });
  }

  async start(session: ASRWriter): Promise<void> {
    this.#chunks = [];
    this.#session = session;
    await this.audio.start();
  }

  async stop(): Promise<Uint8Array[]> {
    await this.audio.stop();
    this.#session = null;
    return this.#chunks;
  }
}
