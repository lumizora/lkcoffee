import { expect, test } from "bun:test";

test("AudioHelper builds and announces protocol version 1", async () => {
  const build = Bun.spawn({
    cmd: ["zsh", "scripts/build-native.sh"],
    stdout: "ignore",
    stderr: "ignore",
  });
  expect(await build.exited).toBe(0);

  const helper = Bun.spawn({
    cmd: ["native/AudioHelper.app/Contents/MacOS/AudioHelper"],
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
  });
  helper.stdin.write('{"id":"hello","type":"hello"}\n');
  const reader = helper.stderr.getReader();
  const { value } = await reader.read();
  const line = new TextDecoder().decode(value).trim().split("\n")[0];
  expect(JSON.parse(line)).toMatchObject({ type: "ready", protocolVersion: 1 });
  helper.kill();
});
