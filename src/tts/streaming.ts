import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import WebSocket from "ws";

const endpoint = "wss://openspeech.bytedance.com/api/v3/tts/bidirection";
const connectionEvents = new Set([1, 2, 50, 51, 52]);

export class VolcengineStreamingTTS {
  constructor({ apiKey, speaker, resourceId = "seed-tts-2.0", url = endpoint, connect = (address, options) => new WebSocket(address, options), spawn: startPlayer = spawn }) {
    if (!apiKey) throw new Error("缺少 VOLCENGINE_API_KEY");
    if (!speaker) throw new Error("缺少 TTS_SPEAKER");
    this.apiKey = apiKey;
    this.speaker = speaker;
    this.resourceId = resourceId;
    this.url = url;
    this.connect = connect;
    this.startPlayer = startPlayer;
  }

  async speak(text) {
    if (!text.trim()) return;
    this.stop();
    const requestId = randomUUID();
    const socket = this.connect(this.url, { perMessageDeflate: false, headers: {
      "X-Api-Key": this.apiKey,
      "X-Api-Resource-Id": this.resourceId,
      "X-Api-Connect-Id": requestId,
    } });
    this.socket = socket;
    try {
      await opened(socket);
      if (this.socket !== socket) return;
      const session = new Session(socket, this.startPlayer, this.speaker, text);
      this.session = session;
      await session.start();
    } catch (error) {
      if (this.socket === socket) throw error;
    } finally {
      if (this.socket === socket) this.socket = null;
      if (this.session?.socket === socket) this.session = null;
    }
  }

  stop() {
    const socket = this.socket;
    this.socket = null;
    this.session?.stop();
    this.session = null;
    socket?.close();
  }
}

class Session {
  constructor(socket, startPlayer, speaker, text) {
    this.socket = socket;
    this.speaker = speaker;
    this.text = text;
    this.sessionId = randomUUID();
    this.player = startPlayer("ffplay", ["-nodisp", "-autoexit", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ch_layout", "mono", "-"], { stdio: ["pipe", "ignore", "ignore"] });
    this.done = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.done.catch(() => {});
  }

  start() {
    this.socket.on("message", (data) => this.receive(data));
    this.socket.on("error", (error) => this.fail(error));
    this.player.on("error", (error) => this.fail(new Error(`语音播放失败：${error.message}`)));
    this.player.stdin.on?.("error", (error) => { if (!this.stopped) this.fail(new Error(`语音播放失败：${error.message}`)); });
    this.socket.send(eventRequest(1));
    return this.done;
  }

  receive(data) {
    if (this.finished) return;
    try {
      const response = parseResponse(data);
      if (response.type === 11 && response.payload.length) this.player.stdin.write(response.payload);
      if (response.type === 15 || [51, 153].includes(response.event)) throw new Error(`豆包语音合成失败：${errorMessage(response.payload)}`);
      if (response.event === 50) this.socket.send(eventRequest(100, this.sessionId, { event: 100, namespace: "BidirectionalTTS", user: { uid: "voice-cli" }, req_params: { speaker: this.speaker, audio_params: { format: "pcm", sample_rate: 24000 } } }));
      if (response.event === 150) {
        this.socket.send(eventRequest(200, this.sessionId, { event: 200, namespace: "BidirectionalTTS", req_params: { text: this.text } }));
        this.socket.send(eventRequest(102, this.sessionId, {}));
      }
      if (response.event === 152) this.finish();
    } catch (error) { this.fail(error); }
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.socket.send(eventRequest(2));
    this.player.once("close", () => { this.socket.close(); this.resolve(); });
    this.player.stdin.end();
  }

  fail(error) {
    if (this.finished) return;
    this.finished = true;
    this.player.kill?.();
    this.socket.close();
    this.reject(error);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.finished = true;
    this.player.kill?.();
    this.socket.close();
    this.resolve();
  }
}

function opened(socket) {
  return new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("语音合成已停止")));
  });
}

function eventRequest(event, sessionId, payload = {}) {
  const session = sessionId ? Buffer.from(sessionId) : Buffer.alloc(0);
  const body = Buffer.from(JSON.stringify(payload));
  const parts = [Buffer.from([0x11, 0x14, 0x10, 0]), int(event)];
  if (sessionId) parts.push(uint(session.length), session);
  parts.push(uint(body.length), body);
  return Buffer.concat(parts);
}

function parseResponse(data) {
  const input = Buffer.from(data);
  const type = input[1] >> 4;
  const flags = input[1] & 0x0f;
  let offset = (input[0] & 0x0f) * 4;
  if (flags === 1 || flags === 3) offset += 4;
  let event;
  if (flags === 4) {
    event = input.readInt32BE(offset);
    offset += 4;
    if (!connectionEvents.has(event)) {
      const size = input.readUInt32BE(offset);
      offset += 4 + size;
    }
  }
  if (type === 15) offset += 4;
  const size = input.readUInt32BE(offset);
  const payload = input.subarray(offset + 4, offset + 4 + size);
  return { type, event, payload: (input[2] & 0x0f) === 1 ? gunzipSync(payload) : payload };
}

function errorMessage(payload) {
  try {
    const body = JSON.parse(payload);
    return body.message ?? body.msg ?? body.error ?? "服务返回错误";
  } catch { return "服务返回错误"; }
}

function int(value) {
  const output = Buffer.alloc(4);
  output.writeInt32BE(value);
  return output;
}

function uint(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32BE(value);
  return output;
}
