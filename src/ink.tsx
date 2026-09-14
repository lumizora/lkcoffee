import React, { useEffect, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import { VolcengineStreamingASR } from "./asr/streaming";
import { VolcengineStreamingTTS } from "./tts/streaming";
import { CoffeeAgent } from "./coffee-agent";
import { locate } from "./location";
import { AudioManager } from "./audio/AudioManager";
import { RecorderBridge } from "./audio/RecorderBridge";
import { statusMark } from "./ink-status";

type Turn = { text: string; role: "user" | "assistant" };
type Result = { text: string; duration: number };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}

function App() {
  const { exit } = useApp();
  const [status, setStatus] = useState("正在初始化...");
  const [recording, setRecording] = useState(false);
  const [recordingFrame, setRecordingFrame] = useState(0);
  const [partial, setPartial] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const runtime = useRef<{
    audio: AudioManager;
    recorder: RecorderBridge;
    asr: VolcengineStreamingASR;
    tts: VolcengineStreamingTTS | null;
    coffee: CoffeeAgent | null;
    session: any;
    lastAudio: Uint8Array[] | null;
    lastResult: Result | null;
    busy: boolean;
  } | null>(null);

  useEffect(() => {
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
    runtime.current = { audio, recorder, asr, tts, coffee: null, session: null, lastAudio: null, lastResult: null, busy: false };
    audio.onError((error) => setStatus("错误 · " + error.message));

    void (async () => {
      try {
        await audio.initialize();
        let permission = await audio.getPermissionStatus();
        if (permission === "not_determined") permission = await audio.requestPermission();
        if (permission !== "granted") {
          setStatus("未获取麦克风权限");
          return;
        }
        setStatus("麦克风已就绪");
        if (process.env.DEEPSEEK_API_KEY && process.env.LUCKIN_MCP_TOKEN) {
          setStatus("正在获取当前位置...");
          let location;
          try { location = await locate(); } catch {}
          runtime.current!.coffee = new CoffeeAgent({
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: process.env.DEEPSEEK_BASE_URL,
            model: process.env.DEEPSEEK_MODEL,
            token: process.env.LUCKIN_MCP_TOKEN,
            url: process.env.LUCKIN_MCP_URL,
            location,
          });
          setStatus(location ? "已获取当前位置，可直接查询附近门店" : "麦克风已就绪");
        }
      } catch (error) {
        setStatus("错误 · " + errorMessage(error));
      }
    })();

    return () => {
      tts?.stop();
      void audio.shutdown();
    };
  }, []);

  useEffect(() => {
    if (!recording) {
      setRecordingFrame(0);
      return;
    }
    const timer = setInterval(() => setRecordingFrame((frame) => frame + 1), 180);
    return () => clearInterval(timer);
  }, [recording]);

  async function reply(result: Result, includeUser = true) {
    const current = runtime.current!;
    if (includeUser) setTurns((items) => [...items, { role: "user", text: result.text }]);
    setStatus("识别完成 · " + (result.duration / 1000).toFixed(1) + " 秒");
    if (!current.coffee) return;
    setStatus("正在查询瑞幸...");
    const response = await current.coffee.ask(result.text);
    setTurns((items) => [
      ...items,
      { role: "assistant", text: response.text },
      ...(response.qrCodeUrl ? [{ role: "assistant" as const, text: "支付二维码\n" + response.qrCodeUrl }] : []),
    ]);
    setStatus("等待录音");
    if (current.tts) void current.tts.speak(response.text).catch((error: Error) => setStatus("播报失败 · " + error.message));
    if (response.qrCodeUrl) Bun.spawn(["open", response.qrCodeUrl]);
  }

  async function stop(send: boolean) {
    const current = runtime.current;
    if (!current?.session) return;
    setRecording(false);
    setStatus("正在完成识别...");
    current.lastAudio = await current.recorder.stop();
    const result = await current.session.finish() as Result;
    current.session = null;
    current.lastResult = result;
    setPartial("");
    if (send) await reply(result);
    else {
      setTurns((items) => [...items, { role: "user", text: result.text }]);
      setStatus("识别完成 · " + (result.duration / 1000).toFixed(1) + " 秒 · Enter 发送");
    }
  }

  async function start() {
    const current = runtime.current;
    if (!current) return;
    current.tts?.stop();
    setPartial("");
    current.session = await current.asr.start(setPartial);
    await current.recorder.start(current.session);
    setRecording(true);
    setStatus("正在录音 · 实时识别中");
  }

  useInput((input, key) => {
    const current = runtime.current;
    if (!current || current.busy) return;
    if (input === "q" || (key.ctrl && input === "c")) {
      current.tts?.stop();
      exit();
      return;
    }
    current.busy = true;
    void (async () => {
      try {
        if (input === " ") {
          if (current.audio.getStatus() === "capturing") await stop(false);
          else await start();
        } else if (key.return) {
          if (current.audio.getStatus() === "capturing") await stop(true);
          else if (current.lastResult) await reply(current.lastResult, false);
        } else if (input === "t" && current.lastAudio) {
          setStatus("正在重试识别...");
          const retry = await current.asr.start(setPartial);
          for (const chunk of current.lastAudio) retry.write(chunk);
          await reply(await retry.finish() as Result);
        } else if (input === "d") {
          current.lastAudio = null;
          current.lastResult = null;
          setStatus("已删除最近一次录音");
        }
      } catch (error) {
        setRecording(false);
        setStatus("错误 · " + errorMessage(error));
      } finally {
        current.busy = false;
      }
    })();
  });

  return (
    <Box flexDirection="column" width={88}>
      <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} justifyContent="space-between">
        <Text bold color="cyan">☕ Voice Coffee</Text>
        <Text dimColor>语音点单助手 · Ink</Text>
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Text dimColor>Space 录音/停止   Enter 发送   T 重试   D 删除   Q 退出</Text>
      </Box>
      {turns.map((turn, index) => (
        <Box key={index} marginTop={1} borderStyle="round" borderColor={turn.role === "user" ? "blue" : "green"} paddingX={2} paddingY={1}>
          <Text color={turn.role === "user" ? "blue" : "green"}>{turn.text}</Text>
        </Box>
      ))}
      {partial && <Box marginTop={1} paddingX={2}><Text dimColor>◌ {partial}</Text></Box>}
      <Box marginTop={1} borderStyle="single" borderColor={recording ? "red" : "gray"} paddingX={2} paddingY={1}>
        <Text color={recording ? "red" : "yellow"}>{statusMark(recording, recordingFrame)} {status}</Text>
      </Box>
    </Box>
  );
}

if (!process.env.VOLCENGINE_API_KEY) throw new Error("缺少 VOLCENGINE_API_KEY");
if (process.env.TTS_SPEAKER && !Bun.which("ffplay")) throw new Error("未找到 ffplay，请先安装：brew install ffmpeg");
render(<App />);
