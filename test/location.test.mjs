import assert from "node:assert/strict";
import test from "node:test";
import { locate } from "../src/location.js";

test("locate returns coordinates emitted by the native helper", async () => {
  const location = await locate((_file, _args, _options, done) => done(null, '{"latitude":31.2304,"longitude":121.4737}\n'));
  assert.deepEqual(location, { latitude: 31.2304, longitude: 121.4737 });
});

test("locate keeps the native permission error", async () => {
  await assert.rejects(
    locate((_file, _args, _options, done) => done(new Error("failed"), "", "未获定位权限")),
    { message: "未获定位权限" },
  );
});
