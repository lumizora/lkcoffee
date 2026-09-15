import assert from "node:assert/strict";
import { gunzipSync, gzipSync } from "node:zlib";
import test from "node:test";
import { VolcengineStreamingASR } from "../src/asr/streaming";

class FakeSocket {
  handlers: Record<string, Array<(value?: Buffer) => void>> = {};
  sent: Buffer[] = [];
  response?: Buffer;
  requestId?: string;

  constructor() {
    queueMicrotask(() => this.emit("open"));
  }

  on(event: string, handler: (value?: Buffer) => void) {
    (this.handlers[event] ??= []).push(handler);
  }

  send(data: Uint8Array) {
    this.sent.push(Buffer.from(data));
    if ((data[1] & 0x0f) === 3) queueMicrotask(() => this.emit("message", this.response ?? finalResponse()));
  }

  close() {}

  emit(event: string, value?: Buffer) {
    for (const handler of this.handlers[event] ?? []) handler(value);
  }
}

function finalResponse() {
  const payload = gzipSync(JSON.stringify({ audio_info: { duration: 1000 }, result: [{ text: "确认下单", definite: true }] }));
  const frame = Buffer.alloc(12);
  frame.set([0x11, 0x93, 0x11, 0]);
  frame.writeInt32BE(-3, 4);
  frame.writeUInt32BE(payload.length, 8);
  return Buffer.concat([frame, payload]);
}

function plainResponse() {
  const payload = Buffer.from(JSON.stringify({ audio_info: { duration: 1000 }, result: [{ text: "确认下单" }] }));
  const frame = Buffer.alloc(12);
  frame.set([0x11, 0x93, 0x10, 0]);
  frame.writeInt32BE(-3, 4);
  frame.writeUInt32BE(payload.length, 8);
  return Buffer.concat([frame, payload]);
}

test("streams PCM to the 2.0 WebSocket and returns the final transcript", async () => {
  let socket: FakeSocket | undefined;
  const partials: string[] = [];
  const asr = new VolcengineStreamingASR({
    apiKey: "test-key",
    connect: ((url: string, options: { headers?: Record<string, string>; perMessageDeflate?: boolean }) => {
      assert.equal(url, "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async");
      assert.equal(options.headers?.["X-Api-Resource-Id"], "volc.seedasr.sauc.duration");
      assert.equal(options.perMessageDeflate, false);
      socket = new FakeSocket();
      socket.requestId = options.headers?.["X-Api-Request-Id"];
      return socket;
    }) as never,
  });

  const session = await asr.start((text) => partials.push(text));
  session.write(Buffer.from("pcm"));
  const result = await session.finish();
  assert.ok(socket);

  assert.deepEqual(socket.sent[0]?.subarray(0, 4), Buffer.from([0x11, 0x11, 0x11, 0]));
  assert.equal(socket.sent[1]?.[1]! >> 4, 2);
  assert.equal(socket.sent[2]?.[1]! & 0x0f, 3);
  assert.deepEqual(partials, ["确认下单"]);
  assert.deepEqual(result, { text: "确认下单", duration: 1000, utterances: [], requestId: socket.requestId });
});

test("accepts uncompressed streaming responses", async () => {
  const asr = new VolcengineStreamingASR({
    apiKey: "test-key",
    connect: (() => {
      const socket = new FakeSocket();
      socket.response = plainResponse();
      return socket;
    }) as never,
  });

  const session = await asr.start();
  session.write(Buffer.from("pcm"));
  assert.equal((await session.finish()).text, "确认下单");
});

test("encodes Uint8Array microphone frames as raw PCM", async () => {
  let socket: FakeSocket | undefined;
  const asr = new VolcengineStreamingASR({
    apiKey: "test-key",
    connect: (() => {
      socket = new FakeSocket();
      return socket;
    }) as never,
  });

  const session = await asr.start();
  session.write(new Uint8Array([1, 2, 3]));

  assert.ok(socket);
  assert.deepEqual(gunzipSync(socket.sent[1]!.subarray(12)), Buffer.from([1, 2, 3]));
  await session.finish().catch(() => {});
});

test("rejects a final response without speech", async () => {
  const asr = new VolcengineStreamingASR({
    apiKey: "test-key",
    connect: (() => {
      const socket = new FakeSocket();
      const response = Buffer.concat([plainResponse().subarray(0, 12), Buffer.from(JSON.stringify({ result: [] }))]);
      response.writeUInt32BE(response.length - 12, 8);
      socket.response = response;
      return socket;
    }) as never,
  });

  const session = await asr.start();
  session.write(Buffer.from("pcm"));
  await assert.rejects(() => session.finish(), { message: "未检测到有效语音" });
});
