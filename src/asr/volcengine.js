import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const messages = {
  "20000003": "未检测到有效语音",
  "45000002": "录音文件为空",
  "45000151": "豆包无法解析录音格式",
};

export class VolcengineASR {
  constructor({ apiKey, resourceId = "volc.bigasr.auc_turbo", url = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash", fetch: request = fetch }) {
    if (!apiKey) throw new Error("缺少 VOLCENGINE_API_KEY");
    this.apiKey = apiKey;
    this.resourceId = resourceId;
    this.url = url;
    this.fetch = request;
  }

  async transcribe(filePath) {
    const requestId = randomUUID();
    const response = await this.fetch(this.url, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": this.apiKey,
        "X-Api-Resource-Id": this.resourceId,
        "X-Api-Request-Id": requestId,
        "X-Api-Sequence": "-1",
      },
      body: JSON.stringify({
        user: { uid: "voice-cli" },
        audio: { data: (await readFile(filePath)).toString("base64") },
        request: { model_name: "bigmodel" },
      }),
    });
    const statusCode = response.headers.get("X-Api-Status-Code");
    const logId = response.headers.get("X-Tt-Logid") ?? "unknown";
    if (statusCode !== "20000000") {
      const message = messages[statusCode] ?? (response.status === 401 || response.status === 403 ? "豆包语音 API 鉴权失败" : "豆包语音识别失败");
      throw new Error(`${message} (${statusCode ?? response.status}, logId: ${logId})`);
    }
    const body = await response.json();
    return {
      text: body.result?.text ?? "",
      duration: body.audio_info?.duration ?? 0,
      utterances: body.result?.utterances ?? [],
      requestId,
      logId,
    };
  }
}
