import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import test from "node:test";
import { downloadVoice } from "../src/ilink/media";

test("iLink decrypts voice media before converting it to PCM", async () => {
  const key = Buffer.from("0123456789abcdef");
  const cipher = createCipheriv("aes-128-ecb", key, null);
  const encrypted = Buffer.concat([cipher.update("voice-bytes"), cipher.final()]);
  let converted: Buffer | undefined;

  const voice = await downloadVoice(
    { media: { full_url: "https://cdn.example.test/voice", aes_key: key.toString("base64") } },
    async () => new Response(encrypted),
    async (input) => {
      converted = Buffer.from(input);
      return Buffer.from("pcm");
    },
  );

  assert.deepEqual(converted, Buffer.from("voice-bytes"));
  assert.deepEqual(voice.pcm, Buffer.from("pcm"));
});
