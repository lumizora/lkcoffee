type StatusType = "recording" | "thinking" | "success" | "warning" | "error";

const palette: Record<StatusType | "user" | "coffee" | "muted", string> = {
  user: "\x1b[38;5;81m",
  coffee: "\x1b[38;5;208m",
  success: "\x1b[38;5;114m",
  recording: "\x1b[38;5;203m",
  warning: "\x1b[38;5;221m",
  thinking: "\x1b[38;5;244m",
  error: "\x1b[38;5;203m",
  muted: "\x1b[38;5;244m",
};
const reset = "\x1b[0m";
const divider = "────────────────────────────────────────";
let showingPartial = false;

export function formatMessage(_role: string, text: string) {
  return `${divider}\n${text}\n${divider}`;
}

export function message(role: string, text: string) {
  endPartial();
  console.log(`\n${formatMessage(role, text)}`);
}

export function status(type: StatusType, text: string) {
  endPartial();
  const icon = { recording: "●", thinking: "◌", success: "✓", warning: "!", error: "×" }[type];
  const color = palette[type] ?? palette.muted;
  console.log(`${color}${icon} ${text}${reset}`);
}

export function header() {
  console.log("\n\x1b[1m☕ Voice Coffee\x1b[0m  ·  语音点单助手\n\x1b[38;5;244mSpace 录音/停止  Enter 停止并发送  T 重试识别  D 删除录音  Q 退出\x1b[0m\n");
}

export function partial(text: string) {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\r\x1b[2K${palette.muted}◌ ${text}${reset}`);
  showingPartial = true;
}

export function qr(url: string) {
  console.log(`\n${divider}\n支付二维码\n${url}\n${divider}`);
}

export function openPayment(url: string, run: (file: string, args: string[]) => unknown = execFile) {
  run("open", [url]);
}

function endPartial() {
  if (showingPartial) process.stdout.write("\n");
  showingPartial = false;
}
import { execFile } from "node:child_process";
