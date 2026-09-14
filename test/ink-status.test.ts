import { expect, test } from "bun:test";
import { statusMark } from "../src/ink-status";

test("cycles the recording status mark and resets when idle", () => {
  expect(statusMark(true, 0)).toBe("●");
  expect(statusMark(true, 1)).toBe("◐");
  expect(statusMark(true, 4)).toBe("●");
  expect(statusMark(false, 2)).toBe("◌");
});
