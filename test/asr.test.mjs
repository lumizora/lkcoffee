import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { VolcengineASR } from "../src/asr/volcengine.js";

test("transcribe sends WAV base64 with the new Volcengine headers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voice-asr-"));
  const wav = join(dir, "sample.wav");
  await writeFile(wav, Buffer.from("wav-bytes"));
  let request;
  const asr = new VolcengineASR({
    apiKey: "test-key",
    fetch: async (url, options) => {
      request = { url, ...options };
      return new Response(JSON.stringify({
        audio_info: { duration: 1200 },
        result: { text: "你好", utterances: [] },
      }), { headers: { "X-Api-Status-Code": "20000000", "X-Tt-Logid": "log-1" } });
    },
  });

  const result = await asr.transcribe(wav);

  assert.equal(request.url, "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash");
  assert.equal(request.headers["X-Api-Key"], "test-key");
  assert.equal(request.headers["X-Api-Resource-Id"], "volc.bigasr.auc_turbo");
  assert.equal(request.headers["X-Api-Sequence"], "-1");
  assert.deepEqual(JSON.parse(request.body), {
    user: { uid: "voice-cli" },
    audio: { data: Buffer.from("wav-bytes").toString("base64") },
    request: { model_name: "bigmodel" },
  });
  assert.deepEqual(result, { text: "你好", duration: 1200, utterances: [], requestId: request.headers["X-Api-Request-Id"], logId: "log-1" });
  await rm(dir, { recursive: true, force: true });
});

test("transcribe reports the Volcengine status code and log ID on failure", async () => {
  const asr = new VolcengineASR({
    apiKey: "test-key",
    fetch: async () => new Response("{}", { headers: {
      "X-Api-Status-Code": "20000003",
      "X-Api-Message": "silent audio",
      "X-Tt-Logid": "log-silent",
    } }),
  });

  await assert.rejects(
    () => asr.transcribe(new URL(import.meta.url)),
    { message: "未检测到有效语音 (20000003, logId: log-silent)" },
  );
});
