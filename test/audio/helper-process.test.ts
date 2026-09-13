import { expect, test } from "bun:test";
import { BunAudioHelperProcess } from "../../src/audio/BunAudioHelperProcess";

test("matches get_devices responses and streams PCM stdout", async () => {
  const helper = new BunAudioHelperProcess({
    command: [process.execPath, "test/fixtures/fake-audio-helper.ts"],
  });

  await helper.start();
  expect(await helper.request("get_devices")).toEqual([
    { id: "default", name: "Default", isDefault: true },
  ]);

  const { value } = await helper.audio.getReader().read();
  expect(value?.byteLength).toBe(640);
  await helper.stop();
});
