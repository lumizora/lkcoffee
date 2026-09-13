import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Recorder } from "../src/recorder.js";

test("recorder captures 16 kHz mono WAV and closes it with ffmpeg q", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voice-recorder-"));
  const child = new EventEmitter();
  let quit = "";
  child.stdin = { write: (value) => { quit += value; } };
  let command;
  const recorder = new Recorder({
    recordingDir: dir,
    device: "Mic",
    spawn: (...args) => { command = args; return child; },
  });

  const file = await recorder.start();
  assert.equal(recorder.isRecording(), true);
  assert.deepEqual(command, ["ffmpeg", [
    "-hide_banner", "-loglevel", "warning", "-f", "avfoundation", "-i", ":Mic",
    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", file,
  ]]);

  const stopped = recorder.stop();
  await writeFile(file, Buffer.alloc(45));
  child.emit("close", 0);
  assert.equal(await stopped, file);
  assert.equal(quit, "q\n");
  assert.equal(recorder.isRecording(), false);
  await rm(dir, { recursive: true, force: true });
});

test("recorder clears its recording state when ffmpeg exits before stop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voice-recorder-"));
  const child = new EventEmitter();
  child.stdin = { write() {} };
  const errors = [];
  const recorder = new Recorder({ recordingDir: dir, spawn: () => child, onError: (error) => errors.push(error.message) });

  await recorder.start();
  child.emit("close", 1);

  assert.equal(recorder.isRecording(), false);
  assert.deepEqual(errors, ["FFmpeg 启动失败（退出码 1）"]);
  await rm(dir, { recursive: true, force: true });
});
