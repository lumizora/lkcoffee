import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import WebSocket from "ws";

const endpoint = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";

export class VolcengineStreamingASR {
  constructor({ apiKey, resourceId = "volc.seedasr.sauc.duration", url = endpoint, connect = (address, options) => new WebSocket(address, options) }) {
    if (!apiKey) throw new Error("缺少 VOLCENGINE_API_KEY");
    this.apiKey = apiKey;
    this.resourceId = resourceId;
    this.url = url;
    this.connect = connect;
  }

  async start(onPartial = () => {}) {
    const requestId = randomUUID();
    const socket = this.connect(this.url, { perMessageDeflate: false, headers: {
      "X-Api-Key": this.apiKey,
      "X-Api-Resource-Id": this.resourceId,
      "X-Api-Request-Id": requestId,
    } });
    await opened(socket);
    const session = new Session(socket, requestId, onPartial);
    socket.on("message", (data) => session.receive(data));
    socket.on("error", (error) => session.fail(error));
    socket.send(fullRequest(1));
    return session;
  }
}

class Session {
  constructor(socket, requestId, onPartial) {
    this.socket = socket;
    this.requestId = requestId;
    this.onPartial = onPartial;
    this.sequence = 2;
    this.ended = false;
    this.text = "";
    this.duration = 0;
    this.utterances = [];
    this.done = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.done.catch(() => {});
  }

  write(chunk) {
    if (this.ended) throw new Error("语音识别已结束");
    const audio = Buffer.from(chunk);
    if (!audio.length) return;
    this.socket.send(audioRequest(this.sequence++, audio));
  }

  finish() {
    if (this.ended) return this.done;
    this.ended = true;
    this.socket.send(audioRequest(this.sequence++, Buffer.alloc(0), true));
    return this.done;
  }

  receive(data) {
    try {
      const response = parseResponse(data);
      if (response.code) throw new Error(`豆包流式识别失败（${response.code}）`);
      const result = response.payload?.result;
      const text = extractText(result);
      if (text) {
        this.text = text;
        this.onPartial(text);
      }
      this.duration = response.payload?.audio_info?.duration ?? this.duration;
      this.utterances = extractUtterances(result);
      if (response.last) {
        if (!this.text.trim()) throw new Error("未检测到有效语音");
        this.resolve({ text: this.text, duration: this.duration, utterances: this.utterances, requestId: this.requestId });
        this.socket.close();
      }
    } catch (error) { this.fail(error); }
  }

  fail(error) {
    if (!this.ended) this.ended = true;
    this.reject(error);
    this.socket.close();
  }
}

function opened(socket) {
  return new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
}

function fullRequest(sequence) {
  return frame(1, 1, sequence, {
    user: { uid: "voice-cli" },
    audio: { format: "pcm", codec: "raw", rate: 16000, bits: 16, channel: 1 },
    request: { model_name: "bigmodel", enable_itn: true, enable_punc: true, enable_ddc: true, enable_nonstream: true },
  });
}

function audioRequest(sequence, audio, last = false) {
  return frame(2, last ? 3 : 1, last ? -sequence : sequence, audio);
}

function frame(type, flags, sequence, payload) {
  const compressed = gzipSync(Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
  const output = Buffer.alloc(12);
  output.set([0x11, type << 4 | flags, 0x11, 0]);
  output.writeInt32BE(sequence, 4);
  output.writeUInt32BE(compressed.length, 8);
  return Buffer.concat([output, compressed]);
}

function parseResponse(data) {
  const input = Buffer.from(data);
  const headerSize = (input[0] & 0x0f) * 4;
  const type = input[1] >> 4;
  const flags = input[1] & 0x0f;
  const compressed = (input[2] & 0x0f) === 1;
  let offset = headerSize;
  if (flags & 1) offset += 4;
  const last = Boolean(flags & 2);
  if (flags & 4) offset += 4;
  let code = 0;
  if (type === 9) offset += 4;
  if (type === 15) {
    code = input.readInt32BE(offset);
    offset += 8;
  }
  const payload = input.subarray(offset);
  return { code, last, payload: payload.length ? JSON.parse(compressed ? gunzipSync(payload) : payload) : undefined };
}

function extractText(result) {
  if (Array.isArray(result)) return result.map((item) => item.text).filter(Boolean).join("");
  return result?.text ?? "";
}

function extractUtterances(result) {
  const items = Array.isArray(result) ? result : [result];
  return items.flatMap((item) => item?.utterances ?? []);
}
