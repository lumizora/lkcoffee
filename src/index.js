import { spawnSync } from "node:child_process";
import { StreamRecorder } from "./recorder.js";
import { VolcengineStreamingASR } from "./asr/streaming.js";
import { VolcengineStreamingTTS } from "./tts/streaming.js";
import { CoffeeAgent } from "./coffee-agent.js";
import * as ui from "./ui.js";
import { locate } from "./location.js";

if (process.platform !== "darwin") throw new Error("当前 MVP 仅支持 macOS（FFmpeg avfoundation）");
if (!process.env.VOLCENGINE_API_KEY) throw new Error("缺少 VOLCENGINE_API_KEY");
if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) throw new Error("未找到 ffmpeg，请先安装：brew install ffmpeg");
if (process.env.TTS_SPEAKER && spawnSync("ffplay", ["-version"], { stdio: "ignore" }).status !== 0) throw new Error("未找到 ffplay，请先安装：brew install ffmpeg");
if (!process.stdin.isTTY) throw new Error("请在交互式终端运行 npm start");

let session = null;
let lastAudio = null;
const recorder = new StreamRecorder({
  device: process.env.AUDIO_DEVICE || "0",
  onData: (chunk) => session?.write(chunk),
  onError: (error) => console.error(`❌ ${error.message}`),
});
const asr = new VolcengineStreamingASR({ apiKey: process.env.VOLCENGINE_API_KEY, resourceId: process.env.VOLCENGINE_RESOURCE_ID, url: process.env.VOLCENGINE_ASR_URL });
const tts = process.env.TTS_SPEAKER ? new VolcengineStreamingTTS({ apiKey: process.env.VOLCENGINE_API_KEY, speaker: process.env.TTS_SPEAKER, resourceId: process.env.TTS_RESOURCE_ID, url: process.env.TTS_URL }) : null;
let coffee = null;
let busy = false;

ui.header();
ui.status("warning", "等待录音");
if (process.env.DEEPSEEK_API_KEY && process.env.LUCKIN_MCP_TOKEN) {
  let location;
  try {
    ui.status("thinking", "正在获取当前位置...");
    location = await locate();
    ui.status("success", "已获取当前位置，可直接查询附近门店");
  } catch (error) {
    ui.status("warning", `${error.message}；请说出商圈或门店名`);
  }
  coffee = new CoffeeAgent({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: process.env.DEEPSEEK_BASE_URL, model: process.env.DEEPSEEK_MODEL, token: process.env.LUCKIN_MCP_TOKEN, url: process.env.LUCKIN_MCP_URL, location });
}
process.stdin.setRawMode(true);
process.stdin.resume();

async function sendResult(result) {
  ui.message("user", result.text);
  ui.status("success", `识别完成 · ${(result.duration / 1000).toFixed(1)} 秒`);
  if (coffee) {
    const reply = await coffee.ask(result.text);
    ui.message("coffee", reply.text);
    if (tts) void tts.speak(reply.text).catch((error) => ui.status("warning", error.message));
    if (reply.qrCodeUrl) {
      ui.qr(reply.qrCodeUrl);
      ui.openPayment(reply.qrCodeUrl);
    }
  }
}

async function stopRecording(send = false) {
  ui.status("thinking", "正在完成识别...");
  try {
    lastAudio = await recorder.stop();
    const result = await session.finish();
    session = null;
    if (send) await sendResult(result);
    else {
      ui.message("user", result.text);
      ui.status("success", `识别完成 · ${(result.duration / 1000).toFixed(1)} 秒`);
    }
  } catch (error) { ui.status("error", error.message); }
}

async function retryRecognition() {
  if (!lastAudio) return ui.status("warning", "当前没有可以识别的录音");
  ui.status("thinking", "正在重试识别...");
  try {
    const retry = await asr.start(ui.partial);
    for (let offset = 0; offset < lastAudio.length; offset += 6400) retry.write(lastAudio.subarray(offset, offset + 6400));
    await sendResult(await retry.finish());
  } catch (error) { ui.status("error", error.message); }
}

async function startRecording() {
  tts?.stop();
  session = await asr.start(ui.partial);
  await recorder.start();
  ui.status("recording", "正在录音 · 实时识别中，Space 停止，Enter 发送");
}

async function quit() {
  tts?.stop();
  if (recorder.isRecording()) {
    ui.status("thinking", "正在保存录音...");
    try { await stopRecording(); } catch (error) { ui.status("error", error.message); }
  }
  process.stdin.setRawMode(false);
  process.exit();
}

process.stdin.on("data", async (input) => {
  if (busy) return ui.status("thinking", "正在处理，请稍候");
  busy = true;
  try {
    const key = input.toString().toLowerCase();
    if (key === "\u0003" || key === "q") return quit();
    if (key === " ") {
      if (recorder.isRecording()) await stopRecording();
      else await startRecording();
    } else if (key === "\r" || key === "\n") {
      if (recorder.isRecording()) await stopRecording(true);
    } else if (key === "t") await retryRecognition();
    else if (key === "d") {
      if (!lastAudio) ui.status("warning", "当前没有可以删除的录音");
      else { lastAudio = null; ui.status("success", "已删除最近一次录音"); }
    }
  } catch (error) { ui.status("error", error.message); } finally { busy = false; }
});
process.once("SIGINT", quit);
process.once("SIGTERM", quit);
