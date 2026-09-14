const recordingMarks = ["●", "◐", "◓", "◑"];
type ReasoningEffort = "low" | "high" | "max";
const reasoningEfforts: ReasoningEffort[] = ["low", "high", "max"];

export function statusMark(recording: boolean, frame: number): string {
  return recording ? recordingMarks[frame % recordingMarks.length] : "◌";
}

export function submissionMode(autoSubmit: boolean): string {
  return `${autoSubmit ? "自动发送" : "手动发送"} · Shift + Tab 切换`;
}

export function nextReasoningEffort(effort: ReasoningEffort): ReasoningEffort {
  return reasoningEfforts[(reasoningEfforts.indexOf(effort) + 1) % reasoningEfforts.length]!;
}

export function reasoningMode(effort: ReasoningEffort): string {
  return `思考 ${effort} · Ctrl+T`;
}

export function recentTurns<T>(turns: T[], rows: number): T[] {
  return turns.slice(-Math.max(1, Math.floor((rows - 7) / 2)));
}

export function formatTurn(role: "user" | "assistant", text: string): string {
  return `${role === "user" ? "›" : " "} ${text}`;
}

export function emptyStateHint(turnCount: number, recording: boolean, partial: string): string {
  return turnCount === 0 && !recording && !partial
    ? "可以直接说：帮我看看附近有哪些门店"
    : "";
}
