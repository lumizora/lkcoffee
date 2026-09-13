import { VolcengineStreamingASR } from "./asr/streaming.js";
import { VolcengineStreamingTTS } from "./tts/streaming.js";
import { CoffeeAgent } from "./coffee-agent.js";
import { locate } from "./location.js";
import * as ui from "./ui.js";
import { AudioManager } from "./audio/AudioManager";
import { RecorderBridge } from "./audio/RecorderBridge";

if (process.platform !== "darwin") throw new Error("当前 MVP 仅支持 macOS");
if (!process.env.VOLCENGINE_API_KEY) throw new Error("缺少 VOLCENGINE_API_KEY");
if (process.env.TTS_SPEAKER && !Bun.which("ffplay")) throw new Error("未找到 ffplay，请先安装：brew install ffmpeg");
if (!process.stdin.isTTY) throw new Error("请在交互式终端运行 bun run start");

let session: Awaited<ReturnType<VolcengineStreamingASR["start"]>> | null = null;
let lastAudio: Uint8Array[] | null = null;
const audio = new AudioManager();
const recorder = new RecorderBridge(audio);
const asr = new VolcengineStreamingASR({
  apiKey: process.env.VOLCENGINE_API_KEY,
  resourceId: process.env.VOLCENGINE_RESOURCE_ID,
  url: process.env.VOLCENGINE_ASR_URL,
});
const tts = process.env.TTS_SPEAKER
  ? new VolcengineStreamingTTS({
    apiKey: process.env.VOLCENGINE_API_KEY,
    speaker: process.env.TTS_SPEAKER,
    resourceId: process.env.TTS_RESOURCE_ID,
    url: process.env.TTS_URL,
  })
  : null;
let coffee: CoffeeAgent | null = null;
let busy = false;

ui.header();
ui.status("warning", "等待录音");
try {
  await audio.initialize();
  let permission = await audio.getPermissionStatus();
  if (permission === "not_determined") permission = await audio.requestPermission();
  if (permission === "granted") ui.status("success", "麦克风已就绪");
  else ui.status("warning", "未获取麦克风权限；请在系统设置中允许 Voice Coffee 使用麦克风");
} catch (error) {
  ui.status("error", error instanceof Error ? error.message : "AudioHelper 启动失败");
}
audio.onError((error) => ui.status("error", error.message));

if (process.env.DEEPSEEK_API_KEY && process.env.LUCKIN_MCP_TOKEN) {
  let location;
  try {
    ui.status("thinking", "正在获取当前位置...");
    location = await locate();
    ui.status("success", "已获取当前位置，可直接查询附近门店");
  } catch (error) {
    ui.status("warning", (error instanceof Error ? error.message : "未获取位置") + "；请说出商圈或门店名");
  }
  coffee = new CoffeeAgent({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL,
    token: process.env.LUCKIN_MCP_TOKEN,
    url: process.env.LUCKIN_MCP_URL,
    location,
  });
}
process.stdin.setRawMode(true);
process.stdin.resume();

async function sendResult(result: { text: string; duration: number }) {
  ui.message("user", result.text);
  ui.status("success", "识别完成 · " + (result.duration / 1000).toFixed(1) + " 秒");
  if (!coffee) return;
  const reply = await coffee.ask(result.text);
  ui.message("coffee", reply.text);
  if (tts) void tts.speak(reply.text).catch((error: Error) => ui.status("warning", error.message));
  if (reply.qrCodeUrl) {
    ui.qr(reply.qrCodeUrl);
    ui.openPayment(reply.qrCodeUrl);
  }
}

async function stopRecording(send = false) {
  ui.status("thinking", "正在完成识别...");
  try {
    lastAudio = await recorder.stop();
    const result = await session?.finish();
    session = null;
    if (!result) throw new Error("语音识别会话不存在");
    if (send) await sendResult(result);
    else {
      ui.message("user", result.text);
      ui.status("success", "识别完成 · " + (result.duration / 1000).toFixed(1) + " 秒");
    }
  } catch (error) {
    ui.status("error", error instanceof Error ? error.message : "识别失败");
  }
}

async function retryRecognition() {
  if (!lastAudio) return ui.status("warning", "当前没有可以识别的录音");
  ui.status("thinking", "正在重试识别...");
  try {
    const retry = await asr.start(ui.partial);
    for (const chunk of lastAudio) retry.write(chunk);
    await sendResult(await retry.finish());
  } catch (error) {
    ui.status("error", error instanceof Error ? error.message : "重试识别失败");
  }
}

async function startRecording() {
  tts?.stop();
  session = await asr.start(ui.partial);
  await recorder.start(session);
  ui.status("recording", "正在录音 · 实时识别中，Space 停止，Enter 发送");
}

async function quit() {
  tts?.stop();
  if (audio.getStatus() === "capturing") {
    ui.status("thinking", "正在保存录音...");
    await stopRecording();
  }
  await audio.shutdown();
  process.stdin.setRawMode(false);
  process.exit();
}

process.stdin.on("data", async (input: Buffer) => {
  if (busy) return ui.status("thinking", "正在处理，请稍候");
  busy = true;
  try {
    const key = input.toString().toLowerCase();
    if (key === "\u0003" || key === "q") return quit();
    if (key === " ") {
      if (audio.getStatus() === "capturing") await stopRecording();
      else await startRecording();
    } else if (key === "\r" || key === "\n") {
      if (audio.getStatus() === "capturing") await stopRecording(true);
    } else if (key === "t") await retryRecognition();
    else if (key === "d") {
      if (!lastAudio) ui.status("warning", "当前没有可以删除的录音");
      else {
        lastAudio = null;
        ui.status("success", "已删除最近一次录音");
      }
    }
  } catch (error) {
    ui.status("error", error instanceof Error ? error.message : "操作失败");
  } finally {
    busy = false;
  }
});
process.once("SIGINT", quit);
process.once("SIGTERM", quit);
