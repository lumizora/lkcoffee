import { expect, test } from "bun:test";
import { AudioManager } from "../../src/audio/AudioManager";
import type { AudioCommandType, AudioEvent } from "../../src/audio/AudioProtocol";

class FakeHelper {
  #controller!: ReadableStreamDefaultController<Uint8Array>;
  readonly requests: Array<{ type: AudioCommandType; payload: unknown }> = [];
  readonly audio = new ReadableStream<Uint8Array>({
    start: (controller) => { this.#controller = controller; },
  });

  async start() {}
  async stop() {}
  onEvent(_listener: (event: AudioEvent) => void) { return () => {}; }
  async request<T = unknown>(type: AudioCommandType, payload?: unknown): Promise<T> {
    this.requests.push({ type, payload });
    return (type === "get_permission" ? "granted" : null) as T;
  }
  emit(chunk: Uint8Array) { this.#controller.enqueue(chunk); }
}

class RestartingHelper {
  #controller!: ReadableStreamDefaultController<Uint8Array>;
  #starts = 0;
  #audio = new ReadableStream<Uint8Array>({
    start: (controller) => { this.#controller = controller; },
  });

  get audio(): ReadableStream<Uint8Array> {
    if (this.#starts < 2) throw new Error("AudioHelper 尚未启动");
    return this.#audio;
  }

  async start() { this.#starts++; }
  async stop() {}
  onEvent(_listener: (event: AudioEvent) => void) { return () => {}; }
  async request<T = unknown>(type: AudioCommandType): Promise<T> {
    return (type === "get_permission" ? "granted" : null) as T;
  }
}

test("forwards complete native frames to listeners", async () => {
  const helper = new FakeHelper();
  const manager = new AudioManager({ helper });
  const sizes: number[] = [];
  manager.onAudio((frame) => sizes.push(frame.data.byteLength));

  await manager.initialize();
  await manager.start();
  helper.emit(new Uint8Array(960));
  helper.emit(new Uint8Array(320));
  await Bun.sleep(0);

  expect(sizes).toEqual([640, 640]);
  expect(helper.requests.map((request) => request.type)).toEqual(["select_device", "start"]);
  await manager.shutdown();
});

test("keeps the PCM stream usable after stopping and starting again", async () => {
  const helper = new FakeHelper();
  const manager = new AudioManager({ helper });
  const sizes: number[] = [];
  manager.onAudio((frame) => sizes.push(frame.data.byteLength));

  await manager.start();
  helper.emit(new Uint8Array(640));
  await Bun.sleep(0);
  await manager.stop();
  await manager.start();
  helper.emit(new Uint8Array(640));
  await Bun.sleep(0);

  expect(sizes).toEqual([640, 640]);
  await manager.shutdown();
});

test("recovers a stopped helper before a new capture", async () => {
  const manager = new AudioManager({ helper: new RestartingHelper() });

  await manager.initialize();
  await manager.start();

  expect(manager.getStatus()).toBe("capturing");
  await manager.shutdown();
});
