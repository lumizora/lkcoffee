import { expect, test } from "bun:test";
import { RecorderBridge } from "../../src/audio/RecorderBridge";

class FakeAudio {
  #listener: ((frame: { data: Uint8Array }) => void) | null = null;
  async start() {}
  async stop() {}
  onAudio(listener: (frame: { data: Uint8Array }) => void) {
    this.#listener = listener;
    return () => { this.#listener = null; };
  }
  emit(data: Uint8Array) { this.#listener?.({ data }); }
}

test("forwards native PCM to ASR without retaining the recording", async () => {
  const audio = new FakeAudio();
  const writes: Uint8Array[] = [];
  const bridge = new RecorderBridge(audio);

  await bridge.start({ write: (data) => writes.push(data) });
  audio.emit(new Uint8Array(640));

  expect(writes).toHaveLength(1);
  expect(await bridge.stop()).toBeUndefined();
});
