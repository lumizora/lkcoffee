import React, { useEffect, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput, useWindowSize } from "ink";
import { VolcengineStreamingASR } from "./asr/streaming";
import { VolcengineStreamingTTS } from "./tts/streaming";
import { CoffeeAgent } from "./coffee-agent";
import { locate } from "./location";
import { AudioManager } from "./audio/AudioManager";
import { RecorderBridge } from "./audio/RecorderBridge";
import { createHoldRelease } from "./hold-space";
import { emptyStateHint, formatTurn, recentTurns, statusMark, submissionMode } from "./ink-status";

type Turn = { text: string; role: "user" | "assistant" };
type Result = { text: string; duration: number };

const colors = {
  accent: "#eeb76b",
  text: "#eee7dc",
  muted: "#8e8982",
  line: "#4b4844",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}

function App() {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [status, setStatus] = useState("正在初始化...");
  const [recording, setRecording] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [locationReady, setLocationReady] = useState(false);
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
    starting: boolean;
    holding: boolean;
    releasePending: boolean;
  } | null>(null);
  const autoSubmitRef = useRef(true);
  const finishHeldRef = useRef<() => void>(() => {});
  const hold = useRef<ReturnType<typeof createHoldRelease> | null>(null);
  if (!hold.current) hold.current = createHoldRelease(() => finishHeldRef.current());

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
    runtime.current = { audio, recorder, asr, tts, coffee: null, session: null, lastAudio: null, lastResult: null, busy: false, starting: false, holding: false, releasePending: false };
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
          setLocationReady(Boolean(location));
          runtime.current!.coffee = new CoffeeAgent({
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: process.env.DEEPSEEK_BASE_URL,
            model: process.env.DEEPSEEK_MODEL,
            token: process.env.LUCKIN_MCP_TOKEN,
            url: process.env.LUCKIN_MCP_URL,
            location,
          });
          setStatus("等待录音");
        }
      } catch (error) {
        setStatus("错误 · " + errorMessage(error));
      }
    })();

    return () => {
      hold.current?.cancel();
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
    const session = current.session;
    current.session = null;
    setRecording(false);
    setStatus("正在完成识别...");
    current.lastAudio = await current.recorder.stop();
    const result = await session.finish() as Result;
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
    if (!current || current.session) return;
    current.tts?.stop();
    setPartial("");
    current.session = await current.asr.start(setPartial);
    await current.recorder.start(current.session);
    setRecording(true);
    setStatus("正在录音 · 实时识别中");
  }

  async function finishHeld() {
    const current = runtime.current;
    if (!current?.session || current.busy) return;
    current.busy = true;
    try {
      await stop(autoSubmitRef.current);
    } catch (error) {
      setRecording(false);
      setStatus("错误 · " + errorMessage(error));
    } finally {
      current.busy = false;
    }
  }

  function pressSpace() {
    const current = runtime.current;
    if (!current || (current.busy && !current.starting)) return;
    current.holding = true;
    hold.current!.pulse();
    if (current.session || current.starting) return;
    current.starting = true;
    void start().catch((error) => {
      setRecording(false);
      setStatus("错误 · " + errorMessage(error));
    }).finally(() => {
      current.starting = false;
      if (current.releasePending || !current.holding) {
        current.releasePending = false;
        void finishHeld();
      }
    });
  }

  finishHeldRef.current = () => {
    const current = runtime.current;
    if (!current) return;
    current.holding = false;
    if (current.starting) {
      current.releasePending = true;
      return;
    }
    void finishHeld();
  };

  useInput((input, key) => {
    const current = runtime.current;
    if (!current) return;
    if (input === "q" || (key.ctrl && input === "c")) {
      hold.current?.cancel();
      current.tts?.stop();
      exit();
      return;
    }
    if (key.tab && key.shift) {
      hold.current?.cancel();
      const next = !autoSubmitRef.current;
      autoSubmitRef.current = next;
      setAutoSubmit(next);
      return;
    }
    if (input === " ") {
      pressSpace();
      return;
    }
    if (current.busy) return;
    current.busy = true;
    void (async () => {
      try {
        if (key.return) {
          hold.current?.cancel();
          current.holding = false;
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

  const hint = emptyStateHint(turns.length, recording, partial);

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderBottom borderColor={colors.line} paddingX={1} justifyContent="space-between">
        <Text bold color={colors.accent}>Voice Coffee</Text>
        <Text color={colors.muted}>{locationReady ? "已定位" : "语音点单助手"}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={2} paddingTop={1}>
        {recentTurns(turns, rows).map((turn, index) => (
          <Box key={index} marginBottom={1}>
            <Text color={turn.role === "user" ? colors.accent : colors.text}>{formatTurn(turn.role, turn.text)}</Text>
          </Box>
        ))}
        {partial && <Text color={colors.muted}>  {partial}</Text>}
        {hint && (
          <Box flexGrow={1} alignItems="center" justifyContent="center">
            <Text color={colors.muted}>{hint}</Text>
          </Box>
        )}
      </Box>
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor={colors.line} paddingX={1} justifyContent="space-between" flexShrink={0}>
        <Text bold={recording} color={recording ? colors.accent : status.startsWith("错误") ? "yellow" : colors.text}>{statusMark(recording, recordingFrame)} {status}</Text>
        <Text color={colors.muted}>{submissionMode(autoSubmit)}</Text>
      </Box>
    </Box>
  );
}

if (!process.env.VOLCENGINE_API_KEY) throw new Error("缺少 VOLCENGINE_API_KEY");
if (process.env.TTS_SPEAKER && !Bun.which("ffplay")) throw new Error("未找到 ffplay，请先安装：brew install ffmpeg");
render(<App />);
