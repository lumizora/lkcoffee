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
  async request(type: AudioCommandType, payload?: unknown) {
    this.requests.push({ type, payload });
    if (type === "get_permission") return "granted";
    return null;
  }
  emit(chunk: Uint8Array) { this.#controller.enqueue(chunk); }
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
