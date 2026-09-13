const palette = {
  user: "\x1b[38;5;81m",
  coffee: "\x1b[38;5;208m",
  success: "\x1b[38;5;114m",
  recording: "\x1b[38;5;203m",
  warning: "\x1b[38;5;221m",
  error: "\x1b[38;5;203m",
  muted: "\x1b[38;5;244m",
};
const reset = "\x1b[0m";
const divider = "────────────────────────────────────────";

export function formatMessage(_role, text) {
  return `${divider}\n${text}\n${divider}`;
}

export function message(role, text) {
  console.log(`\n${formatMessage(role, text)}`);
}

export function status(type, text) {
  const icon = { recording: "●", thinking: "◌", success: "✓", warning: "!", error: "×" }[type];
  const color = palette[type] ?? palette.muted;
  console.log(`${color}${icon} ${text}${reset}`);
}

export function header() {
  console.log("\n\x1b[1m☕ Voice Coffee\x1b[0m  ·  语音点单助手\n\x1b[38;5;244mSpace 录音/停止  Enter 停止并发送  T 重试识别  D 删除录音  Q 退出\x1b[0m\n");
}

export function qr(url) {
  console.log(`\n${divider}\n支付二维码\n${url}\n${divider}`);
}

export function openPayment(url, run = execFile) {
  run("open", [url]);
}
import { execFile } from "node:child_process";
