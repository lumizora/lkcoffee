import { expect, test } from "bun:test";
import { createHoldRelease } from "../src/hold-space";

test("releases only after Space repeats stop", async () => {
  let releases = 0;
  const hold = createHoldRelease(() => { releases += 1; }, { initialDelayMs: 60, releaseDelayMs: 30 });

  hold.pulse();
  await Bun.sleep(20);
  hold.pulse();
  await Bun.sleep(20);
  expect(releases).toBe(0);
  await Bun.sleep(20);
  expect(releases).toBe(1);
});

test("cancelling prevents a pending release", async () => {
  let releases = 0;
  const hold = createHoldRelease(() => { releases += 1; }, { initialDelayMs: 20, releaseDelayMs: 20 });

  hold.pulse();
  hold.cancel();
  await Bun.sleep(30);
  expect(releases).toBe(0);
});
