import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { VolcengineStreamingTTS } from "../src/tts/streaming";

class FakeSocket extends EventEmitter {
  sent: Buffer[] = [];
  closed = false;

  constructor() {
    super();
    queueMicrotask(() => this.emit("open"));
  }

  send(data: Uint8Array) {
    const frame = Buffer.from(data);
    this.sent.push(frame);
    const event = frame.readInt32BE(4);
    if (event === 1) queueMicrotask(() => this.emit("message", eventResponse(50)));
    if (event === 100) queueMicrotask(() => this.emit("message", eventResponse(150, frameSessionId(frame))));
    if (event === 200) queueMicrotask(() => {
      this.emit("message", audioResponse(Buffer.from("pcm")));
      this.emit("message", eventResponse(152, frameSessionId(frame)));
    });
  }

  close() {}
}

function frameSessionId(frame: Buffer) {
  const size = frame.readUInt32BE(8);
  return frame.subarray(12, 12 + size).toString();
}

function eventResponse(event: number, sessionId = "") {
  const session = Buffer.from(sessionId);
  const prefix = Buffer.alloc(8 + (sessionId ? 4 + session.length : 0));
  prefix.set([0x11, 0x94, 0x10, 0]);
  prefix.writeInt32BE(event, 4);
  if (sessionId) {
    prefix.writeUInt32BE(session.length, 8);
    session.copy(prefix, 12);
  }
  return Buffer.concat([prefix, Buffer.alloc(4)]);
}

function audioResponse(audio: Buffer) {
  const frame = Buffer.alloc(8);
  frame.set([0x11, 0xb0, 0x10, 0]);
  frame.writeUInt32BE(audio.length, 4);
  return Buffer.concat([frame, audio]);
}

function errorResponse(message: string) {
  const payload = Buffer.from(JSON.stringify({ error: message }));
  const frame = Buffer.alloc(12);
  frame.set([0x11, 0xf0, 0x10, 0]);
  frame.writeUInt32BE(55000000, 4);
  frame.writeUInt32BE(payload.length, 8);
  return Buffer.concat([frame, payload]);
}

test("streams reply text to Doubao and plays returned PCM", async () => {
  let socket: FakeSocket | undefined;
  const player = new EventEmitter() as EventEmitter & { stdin: { write: (chunk: Uint8Array) => void; end: () => void } };
  const written: Buffer[] = [];
  player.stdin = { write: (chunk) => { written.push(Buffer.from(chunk)); }, end: () => queueMicrotask(() => player.emit("close", 0)) };
  const tts = new VolcengineStreamingTTS({
    apiKey: "test-key",
    speaker: "zh_female_test",
    connect: ((url: string, options: { headers?: Record<string, string>; perMessageDeflate?: boolean }) => {
      assert.equal(url, "wss://openspeech.bytedance.com/api/v3/tts/bidirection");
      assert.equal(options.headers?.["X-Api-Resource-Id"], "seed-tts-2.0");
      assert.equal(options.perMessageDeflate, false);
      socket = new FakeSocket();
      return socket;
    }) as never,
    spawn: ((command: string, args: string[]) => {
      assert.equal(command, "ffplay");
      assert.deepEqual(args, ["-nodisp", "-autoexit", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ch_layout", "mono", "-"]);
      return player;
    }) as never,
  });

  await tts.speak("订单已创建");
  assert.ok(socket);

  assert.deepEqual(socket.sent.map((frame) => frame.readInt32BE(4)), [1, 100, 200, 102, 2]);
  assert.deepEqual(written, [Buffer.from("pcm")]);
  const sessionPayloadOffset = 12 + socket.sent[1].readUInt32BE(8);
  const sessionPayload = JSON.parse(socket.sent[1].subarray(sessionPayloadOffset + 4).toString());
  assert.deepEqual(sessionPayload, { event: 100, namespace: "BidirectionalTTS", user: { uid: "voice-cli" }, req_params: { speaker: "zh_female_test", audio_params: { format: "pcm", sample_rate: 24000 } } });
  const payloadOffset = 12 + socket.sent[2].readUInt32BE(8);
  const payload = JSON.parse(socket.sent[2].subarray(payloadOffset + 4).toString());
  assert.deepEqual(payload, { event: 200, namespace: "BidirectionalTTS", req_params: { text: "订单已创建" } });
});

test("shows the TTS service error reason", async () => {
  const player = new EventEmitter() as EventEmitter & { stdin: { write: () => void; end: () => void } };
  player.stdin = { write() {}, end() {} };
  const tts = new VolcengineStreamingTTS({
    apiKey: "test-key",
    speaker: "zh_female_test",
    connect: (() => {
      const socket = new FakeSocket();
      const send = socket.send.bind(socket);
      socket.send = (frame: Uint8Array) => {
        if (Buffer.from(frame).readInt32BE(4) === 200) return queueMicrotask(() => socket.emit("message", errorResponse("音色与模型不匹配")));
        send(frame);
      };
      return socket;
    }) as never,
    spawn: (() => player) as never,
  });

  await assert.rejects(() => tts.speak("语音测试"), { message: "豆包语音合成失败：音色与模型不匹配" });
});

test("stops the active synthesis when recording begins", async () => {
  let socket: FakeSocket | undefined;
  let killed = false;
  const player = new EventEmitter() as EventEmitter & { stdin: EventEmitter & { write: () => void; end: () => void }; kill: () => void };
  player.stdin = new EventEmitter() as EventEmitter & { write: () => void; end: () => void };
  player.stdin.write = () => {};
  player.stdin.end = () => {};
  player.kill = () => { killed = true; };
  const tts = new VolcengineStreamingTTS({
    apiKey: "test-key",
    speaker: "zh_female_test",
    connect: (() => {
      const connected = new FakeSocket();
      socket = connected;
      connected.send = (frame: Uint8Array) => connected.sent.push(Buffer.from(frame));
      connected.close = () => { connected.closed = true; };
      return connected;
    }) as never,
    spawn: (() => player) as never,
  });

  const speaking = tts.speak("正在播报");
  await new Promise((resolve) => setImmediate(resolve));
  tts.stop();
  assert.doesNotThrow(() => player.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" })));
  await speaking;
  assert.ok(socket);

  assert.equal(killed, true);
  assert.equal(socket.closed, true);
});
