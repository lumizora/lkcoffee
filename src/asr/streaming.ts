import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import WebSocket from "ws";

type ASRResult = { text?: string; utterances?: unknown[] };
type ASRPayload = { result?: ASRResult | ASRResult[]; audio_info?: { duration?: number } };
type ASRResponse = { code: number; last: boolean; payload?: ASRPayload };
type Connect = (address: string, options: WebSocket.ClientOptions) => WebSocket;

export type ASRTranscript = { text: string; duration: number; utterances: unknown[]; requestId: string };
export type ASROptions = { apiKey?: string; resourceId?: string; url?: string; connect?: Connect };

const endpoint = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";

export class VolcengineStreamingASR {
  private apiKey: string;
  private resourceId: string;
  private url: string;
  private connect: Connect;

  constructor({ apiKey, resourceId = "volc.seedasr.sauc.duration", url = endpoint, connect = (address, options) => new WebSocket(address, options) }: ASROptions) {
    if (!apiKey) throw new Error("缺少 VOLCENGINE_API_KEY");
    this.apiKey = apiKey;
    this.resourceId = resourceId;
    this.url = url;
    this.connect = connect;
  }

  async start(onPartial: (text: string) => void = () => {}) {
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
  private socket: WebSocket;
  private requestId: string;
  private onPartial: (text: string) => void;
  private sequence = 2;
  private ended = false;
  private text = "";
  private duration = 0;
  private utterances: unknown[] = [];
  private resolve!: (value: ASRTranscript) => void;
  private reject!: (reason?: unknown) => void;
  private done: Promise<ASRTranscript>;

  constructor(socket: WebSocket, requestId: string, onPartial: (text: string) => void) {
    this.socket = socket;
    this.requestId = requestId;
    this.onPartial = onPartial;
    this.done = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.done.catch(() => {});
  }

  write(chunk: Uint8Array) {
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

  receive(data: WebSocket.RawData) {
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

  fail(error: unknown) {
    if (!this.ended) this.ended = true;
    this.reject(error);
    this.socket.close();
  }
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
}

function fullRequest(sequence: number): Buffer {
  return frame(1, 1, sequence, {
    user: { uid: "voice-cli" },
    audio: { format: "pcm", codec: "raw", rate: 16000, bits: 16, channel: 1 },
    request: { model_name: "bigmodel", enable_itn: true, enable_punc: true, enable_ddc: true, enable_nonstream: true },
  });
}

function audioRequest(sequence: number, audio: Buffer, last = false): Buffer {
  return frame(2, last ? 3 : 1, last ? -sequence : sequence, audio);
}

function frame(type: number, flags: number, sequence: number, payload: Buffer | object): Buffer {
  const compressed = gzipSync(Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
  const output = Buffer.alloc(12);
  output.set([0x11, type << 4 | flags, 0x11, 0]);
  output.writeInt32BE(sequence, 4);
  output.writeUInt32BE(compressed.length, 8);
  return Buffer.concat([output, compressed]);
}

function parseResponse(data: WebSocket.RawData): ASRResponse {
  const input = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
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
  return { code, last, payload: payload.length ? JSON.parse((compressed ? gunzipSync(payload) : payload).toString()) as ASRPayload : undefined };
}

function extractText(result: ASRResult | ASRResult[] | undefined): string {
  if (Array.isArray(result)) return result.map((item) => item.text).filter(Boolean).join("");
  return result?.text ?? "";
}

function extractUtterances(result: ASRResult | ASRResult[] | undefined): unknown[] {
  const items = Array.isArray(result) ? result : [result];
  return items.flatMap((item) => item?.utterances ?? []);
}
