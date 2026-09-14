import { expect, test } from "bun:test";
import { emptyStateHint, formatTurn, nextReasoningEffort, reasoningMode, recentTurns, statusMark, submissionMode } from "../src/ink-status";

test("cycles the recording status mark and resets when idle", () => {
  expect(statusMark(true, 0)).toBe("●");
  expect(statusMark(true, 1)).toBe("◐");
  expect(statusMark(true, 4)).toBe("●");
  expect(statusMark(false, 2)).toBe("◌");
});

test("labels the current submission mode for the status bar", () => {
  expect(submissionMode(true)).toBe("自动发送 · Shift + Tab 切换");
  expect(submissionMode(false)).toBe("手动发送 · Shift + Tab 切换");
});

test("cycles and labels DeepSeek reasoning effort", () => {
  expect(nextReasoningEffort("high")).toBe("max");
  expect(nextReasoningEffort("max")).toBe("low");
  expect(nextReasoningEffort("low")).toBe("high");
  expect(reasoningMode("high")).toBe("思考 high · Ctrl+T");
});

test("keeps the newest turns visible in the fixed chat viewport", () => {
  expect(recentTurns(["1", "2", "3", "4", "5", "6"], 17)).toEqual(["2", "3", "4", "5", "6"]);
  expect(recentTurns(["1", "2"], 8)).toEqual(["2"]);
});

test("uses a quiet prompt marker instead of message cards", () => {
  expect(formatTurn("user", "帮我看看附近门店")).toBe("› 帮我看看附近门店");
  expect(formatTurn("assistant", "最近的是沂州里店")).toBe("  最近的是沂州里店");
});

test("shows the suggestion only in an idle empty conversation", () => {
  expect(emptyStateHint(0, false, "")).toBe("可以直接说：帮我看看附近有哪些门店");
  expect(emptyStateHint(1, false, "")).toBe("");
  expect(emptyStateHint(0, true, "")).toBe("");
  expect(emptyStateHint(0, false, "附近")).toBe("");
});
