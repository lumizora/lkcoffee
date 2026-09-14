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

test("AudioHelper lists the system input devices", async () => {
  const build = Bun.spawn({ cmd: ["zsh", "scripts/build-native.sh"], stdout: "ignore", stderr: "ignore" });
  expect(await build.exited).toBe(0);

  const helper = Bun.spawn({
    cmd: ["native/AudioHelper.app/Contents/MacOS/AudioHelper"],
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
  });
  helper.stdin.write('{"id":"devices","type":"get_devices"}\n');
  const reader = helper.stderr.getReader();
  let text = "";
  while (!text.includes('"id":"devices"')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  const response = text.split("\n").filter(Boolean).map(JSON.parse).find((line) => line.id === "devices");
  expect(response.payload.length).toBeGreaterThan(0);
  helper.kill();
});

test("AudioHelper can start a new capture after stopping", async () => {
  const build = Bun.spawn({ cmd: ["zsh", "scripts/build-native.sh"], stdout: "ignore", stderr: "ignore" });
  expect(await build.exited).toBe(0);

  const helper = Bun.spawn({
    cmd: ["native/AudioHelper.app/Contents/MacOS/AudioHelper"],
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
  });
  const reader = helper.stderr.pipeThrough(new TextDecoderStream()).getReader();
  const messages = new Map<string, any>();
  const waitFor = async (id: string) => {
    while (!messages.has(id)) {
      const { value, done } = await reader.read();
      if (done) throw new Error("AudioHelper 在响应前退出");
      for (const line of value.split("\n")) {
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.id) messages.set(message.id, message);
      }
    }
    return messages.get(id);
  };
  const request = async (id: string, type: string) => {
    helper.stdin.write(JSON.stringify({ id, type }) + "\n");
    return waitFor(id);
  };

  const permission = await request("permission", "get_permission");
  if (permission.payload !== "granted") {
    helper.kill();
    return;
  }
  expect((await request("start-1", "start")).success).toBe(true);
  expect((await request("stop", "stop")).success).toBe(true);
  expect((await request("start-2", "start")).success).toBe(true);
  expect((await request("shutdown", "shutdown")).success).toBe(true);
  expect(await helper.exited).toBe(0);
});
