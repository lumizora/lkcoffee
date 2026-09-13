import React, { useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";

type Turn = { text: string; tone: "user" | "assistant" };

function App() {
  const { exit } = useApp();
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("等待录音");
  const [turns, setTurns] = useState<Turn[]>([]);

  useInput((input, key) => {
    if (input === "q" || key.ctrl && input === "c") exit();
    if (input === " ") {
      setRecording((active) => {
        setStatus(active ? "录音完成 · 按 Enter 发送" : "正在录音 · 再按 Space 停止");
        return !active;
      });
    }
    if (key.return && !recording) {
      setStatus("正在识别语音...");
      setTimeout(() => {
        setTurns([
          ...turns,
          { text: "帮我看一下附近的门店。", tone: "user" },
          { text: "附近有 3 家门店，最近的是临沂百丽广场店，约 1.4 公里。", tone: "assistant" },
        ]);
        setStatus("等待录音");
      }, 450);
    }
  });

  return (
    <Box flexDirection="column" width={76}>
      <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} justifyContent="space-between">
        <Text bold color="cyan">☕ Voice Coffee</Text>
        <Text dimColor>语音点单助手 · Ink UI Spike</Text>
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Text dimColor>Space 录音/停止   Enter 发送   Q 退出</Text>
      </Box>
      <Box marginTop={1} borderStyle="single" borderColor={recording ? "red" : "gray"} paddingX={2} paddingY={1}>
        <Text color={recording ? "red" : "yellow"}>{recording ? "● " : "◌ "}{status}</Text>
      </Box>
      {turns.map((turn, index) => (
        <Box key={index} marginTop={1} borderStyle="round" borderColor={turn.tone === "user" ? "blue" : "green"} paddingX={2} paddingY={1}>
          <Text color={turn.tone === "user" ? "blue" : "green"}>{turn.text}</Text>
        </Box>
      ))}
    </Box>
  );
}

render(<App />);
