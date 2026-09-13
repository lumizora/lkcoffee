import type { AudioCommandType, AudioError, AudioEvent, AudioResponse } from "./AudioProtocol";
import { PROTOCOL_VERSION } from "./AudioProtocol";

type Pending = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: Timer;
};

export class BunAudioHelperProcess {
  #process: ReturnType<typeof Bun.spawn> | null = null;
  #ready: Promise<void> | null = null;
  #resolveReady: (() => void) | null = null;
  #rejectReady: ((error: Error) => void) | null = null;
  #pending = new Map<string, Pending>();
  #events = new Set<(event: AudioEvent) => void>();
  #stopping = false;

  constructor(readonly options: { command: string[]; timeoutMs?: number }) {}

  get audio(): ReadableStream<Uint8Array> {
    if (!this.#process) throw new Error("AudioHelper 尚未启动");
    return this.#process.stdout;
  }

  onEvent(listener: (event: AudioEvent) => void): () => void {
    this.#events.add(listener);
    return () => this.#events.delete(listener);
  }

  async start(): Promise<void> {
    if (this.#process) return this.#ready ?? Promise.resolve();
    this.#stopping = false;
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    this.#process = Bun.spawn({
      cmd: this.options.command,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    void this.#readControl(this.#process.stderr);
    void this.#watchExit(this.#process);
    return this.#ready;
  }

  async request<T = unknown>(type: AudioCommandType, payload?: unknown): Promise<T> {
    if (!this.#process) throw new Error("AudioHelper 尚未启动");
    const id = crypto.randomUUID();
    const timeoutMs = this.options.timeoutMs ?? 5000;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new AudioHelperProcessError({ code: "IPC_FAILED", message: "AudioHelper 请求超时", recoverable: true }));
      }, timeoutMs);
      this.#pending.set(id, { resolve: resolve as (payload: unknown) => void, reject, timer });
      this.#process?.stdin.write(JSON.stringify({ id, type, payload }) + "\n");
    });
  }

  async stop(): Promise<void> {
    if (!this.#process) return;
    this.#stopping = true;
    try {
      await this.request("shutdown");
    } catch {
      this.#process.kill();
    }
    await this.#process.exited;
  }

  async #readControl(stream: ReadableStream<Uint8Array>): Promise<void> {
    let pending = "";
    for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) this.#handleControl(line);
    }
  }

  #handleControl(line: string): void {
    if (!line) return;
    let message: AudioEvent | AudioResponse;
    try {
      message = JSON.parse(line);
    } catch {
      this.#fail(new AudioHelperProcessError({ code: "PROTOCOL_ERROR", message: "AudioHelper 返回了无效 JSON", recoverable: false }));
      return;
    }
    if (message.type === "response") {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.success) pending.resolve(message.payload);
      else pending.reject(new AudioHelperProcessError(message.error ?? { code: "INTERNAL_ERROR", message: "AudioHelper 请求失败", recoverable: false }));
      return;
    }
    if (message.type === "ready") {
      if (message.protocolVersion !== PROTOCOL_VERSION) {
        this.#fail(new AudioHelperProcessError({ code: "PROTOCOL_ERROR", message: "AudioHelper 协议版本不匹配", recoverable: false }));
      } else {
        this.#resolveReady?.();
      }
    }
    for (const listener of this.#events) listener(message);
  }

  async #watchExit(process: ReturnType<typeof Bun.spawn>): Promise<void> {
    await process.exited;
    if (!this.#stopping) this.#fail(new AudioHelperProcessError({ code: "HELPER_CRASHED", message: "AudioHelper 已退出", recoverable: true }));
    this.#process = null;
  }

  #fail(error: Error): void {
    this.#rejectReady?.(error);
    this.#rejectReady = null;
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#pending.delete(id);
    }
  }
}

export class AudioHelperProcessError extends Error {
  readonly code: AudioError["code"];
  readonly recoverable: boolean;

  constructor(error: AudioError) {
    super(error.message);
    this.code = error.code;
    this.recoverable = error.recoverable;
  }
}
