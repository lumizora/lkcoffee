import { BunAudioHelperProcess } from "./BunAudioHelperProcess";
import type {
  AudioCommandType,
  AudioDevice,
  AudioError,
  AudioEvent,
  AudioPermissionStatus,
  AudioStatus,
} from "./AudioProtocol";
import { PCMFrameParser } from "./PCMFrameParser";

export interface AudioFrame {
  data: Uint8Array;
  sequence: number;
}

export interface AudioHelperClient {
  readonly audio: ReadableStream<Uint8Array>;
  start(): Promise<void>;
  stop(): Promise<void>;
  request<T = unknown>(type: AudioCommandType, payload?: unknown): Promise<T>;
  onEvent(listener: (event: AudioEvent) => void): () => void;
}

export class AudioManager {
  #helper: AudioHelperClient;
  #status: AudioStatus = "uninitialized";
  #selectedDevice = "default";
  #sequence = 0;
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  #audioListeners = new Set<(frame: AudioFrame) => void>();
  #errorListeners = new Set<(error: AudioError) => void>();
  #unsubscribe: (() => void) | null = null;

  constructor(options: { helper?: AudioHelperClient } = {}) {
    this.#helper = options.helper ?? new BunAudioHelperProcess({
      command: [import.meta.dir + "/../../native/AudioHelper.app/Contents/MacOS/AudioHelper"],
    });
  }

  async initialize(): Promise<void> {
    if (this.#status !== "uninitialized") return;
    await this.#helper.start();
    this.#unsubscribe = this.#helper.onEvent((event) => {
      if (event.type === "error" && event.error) this.#emitError(event.error);
    });
    this.#status = "ready";
  }

  async getDevices(): Promise<AudioDevice[]> {
    await this.initialize();
    return this.#helper.request<AudioDevice[]>("get_devices");
  }

  async getDefaultDevice(): Promise<AudioDevice | null> {
    await this.initialize();
    return this.#helper.request<AudioDevice | null>("get_default_device");
  }

  async selectDevice(deviceId: string): Promise<void> {
    await this.initialize();
    this.#selectedDevice = deviceId;
    if (this.#status === "capturing") await this.#helper.request("select_device", { deviceId });
  }

  async getPermissionStatus(): Promise<AudioPermissionStatus> {
    await this.initialize();
    return this.#helper.request<AudioPermissionStatus>("get_permission");
  }

  async requestPermission(): Promise<AudioPermissionStatus> {
    await this.initialize();
    return this.#helper.request<AudioPermissionStatus>("request_permission");
  }

  getStatus(): AudioStatus {
    return this.#status;
  }

  onAudio(listener: (frame: AudioFrame) => void): () => void {
    this.#audioListeners.add(listener);
    return () => this.#audioListeners.delete(listener);
  }

  onError(listener: (error: AudioError) => void): () => void {
    this.#errorListeners.add(listener);
    return () => this.#errorListeners.delete(listener);
  }

  async start(): Promise<void> {
    await this.initialize();
    if (this.#status === "capturing") return;
    await this.#helper.request("select_device", { deviceId: this.#selectedDevice });
    await this.#helper.request("start");
    this.#status = "capturing";
    if (!this.#reader) {
      this.#reader = this.#helper.audio.getReader();
      void this.#consume(this.#reader);
    }
  }

  async stop(): Promise<void> {
    if (this.#status !== "capturing") return;
    this.#status = "ready";
    await this.#helper.request("stop");
  }

  async shutdown(): Promise<void> {
    if (this.#status === "shutdown") return;
    await this.stop();
    await this.#reader?.cancel();
    this.#reader = null;
    this.#unsubscribe?.();
    await this.#helper.stop();
    this.#status = "shutdown";
  }

  async #consume(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const parser = new PCMFrameParser();
    try {
      while (this.#reader === reader) {
        const { done, value } = await reader.read();
        if (done) return;
        for (const data of parser.push(value)) {
          if (this.#status !== "capturing") continue;
          const frame = { data, sequence: this.#sequence++ };
          for (const listener of this.#audioListeners) listener(frame);
        }
      }
    } catch {
      this.#emitError({ code: "IPC_FAILED", message: "AudioHelper 音频流中断", recoverable: true });
    }
  }

  #emitError(error: AudioError): void {
    this.#status = "error";
    for (const listener of this.#errorListeners) listener(error);
  }
}
