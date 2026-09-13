# Bun AudioHelper Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Run Voice Coffee with Bun + TypeScript and capture microphone PCM through an isolated Swift AudioHelper process.

**Architecture:** Bun owns application flow and an AudioManager. The manager starts AudioHelper with Bun.spawn, sends JSONL commands to stdin, parses JSONL events from stderr, and turns stdout into 640-byte Uint8Array PCM frames. AudioHelper owns AVAudioEngine, permission, devices, conversion, and capture.

**Tech Stack:** Bun 1.3.13, TypeScript, bun:test, Swift 6, AVFoundation, AVFAudio, CoreAudio.

**Spec:** docs/superpowers/specs/2026-09-13-bun-audio-helper-design.md

## Global Constraints

- Target macOS only; Windows/WASAPI is excluded.
- AudioHelper is out of process; Bun uses neither FFI nor platform audio APIs.
- PCM output is S16LE, 16 kHz, mono, 20 ms, exactly 640 bytes per frame.
- stdin is JSONL commands, stdout is audio only, stderr is JSONL control only.
- Public audio payloads use Uint8Array; no Buffer public API.
- Protocol version is 1; command IDs are UUIDs; requests time out after 5 seconds.
- Preserve Space/Enter/T/D/Q, ASR, TTS, location, and Coffee MCP behavior.

---

### Task 1: Establish Bun and TypeScript

**Files:**
- Modify: package.json, .env.example, README.md
- Create: tsconfig.json
- Delete: package-lock.json

**Produces:** bun run start, bun run build:native, and bun test.

- [ ] **Step 1: Verify Bun**

Run:

~~~sh
PATH="/Users/passer/.bun/bin:$PATH" bun --version
~~~

Expected: 1.3.13 or newer.

- [ ] **Step 2: Configure scripts**

Set package scripts to:

~~~json
{
  "prestart": "bun run build:native",
  "start": "bun --env-file=.env src/index.ts",
  "build:native": "zsh scripts/build-native.sh",
  "test": "bun test"
}
~~~

Create tsconfig.json with target ESNext, module Preserve, moduleResolution bundler, strict true, and types ["bun-types"].

- [ ] **Step 3: Install lockfile and verify**

~~~sh
PATH="/Users/passer/.bun/bin:$PATH" bun install
rm package-lock.json
PATH="/Users/passer/.bun/bin:$PATH" bun test
~~~

Expected: bun.lock exists and the existing suite passes.

- [ ] **Step 4: Commit**

~~~sh
git add package.json bun.lock tsconfig.json .env.example README.md package-lock.json
git commit -m "build: migrate runtime to Bun"
~~~

### Task 2: Define protocol and PCM frame parser

**Files:**
- Create: src/audio/AudioProtocol.ts, src/audio/PCMFrameParser.ts
- Create: test/audio/pcm-frame-parser.test.ts

**Produces:** protocol version 1 types and PCMFrameParser.push(chunk): Uint8Array[].

- [ ] **Step 1: Write a failing parser test**

~~~ts
import { expect, test } from "bun:test";
import { PCMFrameParser } from "../../src/audio/PCMFrameParser";

test("emits strict 640-byte frames across chunk boundaries", () => {
  const parser = new PCMFrameParser();
  expect(parser.push(new Uint8Array(960)).map((x) => x.byteLength)).toEqual([640]);
  expect(parser.push(new Uint8Array(320)).map((x) => x.byteLength)).toEqual([640]);
});
~~~

- [ ] **Step 2: Confirm it fails**

Run: PATH="/Users/passer/.bun/bin:$PATH" bun test test/audio/pcm-frame-parser.test.ts

Expected: FAIL because PCMFrameParser is absent.

- [ ] **Step 3: Implement parser and protocol**

Define PCM_FRAME_BYTES = 640. The parser appends each chunk to pending bytes, slices every complete 640-byte frame, and retains only the remainder.

Define command types hello, get_permission, request_permission, get_devices, get_default_device, select_device, start, stop, shutdown; response, event, AudioDevice, AudioError and AudioStatus types. Require ready.protocolVersion = 1 and include HELPER_CRASHED, IPC_FAILED, and PROTOCOL_ERROR errors.

- [ ] **Step 4: Verify and commit**

~~~sh
PATH="/Users/passer/.bun/bin:$PATH" bun test test/audio/pcm-frame-parser.test.ts
git add src/audio/AudioProtocol.ts src/audio/PCMFrameParser.ts test/audio/pcm-frame-parser.test.ts
git commit -m "feat: define audio IPC protocol"
~~~

### Task 3: Add BunAudioHelperProcess

**Files:**
- Create: src/audio/BunAudioHelperProcess.ts
- Create: test/audio/helper-process.test.ts, test/fixtures/fake-audio-helper.ts

**Consumes:** Task 2 protocol types.

**Produces:** start(), request(type, payload?), stop(), audio ReadableStream, and onEvent(listener).

- [ ] **Step 1: Write a fake-helper test**

~~~ts
test("matches get_devices responses and streams PCM stdout", async () => {
  const helper = new BunAudioHelperProcess({ command: ["bun", "test/fixtures/fake-audio-helper.ts"] });
  await helper.start();
  await expect(helper.request("get_devices")).resolves.toEqual([
    { id: "default", name: "Default", isDefault: true },
  ]);
});
~~~

The fixture writes ready and response JSONL records to stderr and one 640-byte chunk to stdout.

- [ ] **Step 2: Confirm failure**

Run: PATH="/Users/passer/.bun/bin:$PATH" bun test test/audio/helper-process.test.ts

Expected: FAIL because the process wrapper is absent.

- [ ] **Step 3: Implement lifecycle and protocol**

Use Bun.spawn with piped stdin, stdout, and stderr. Split stderr with TextDecoderStream by complete newline; reject malformed JSON as PROTOCOL_ERROR. Write commands as JSON.stringify({ id: crypto.randomUUID(), type, payload }) plus newline. Require a ready event with protocolVersion 1; correlate responses by ID; reject after 5000 ms; reject all requests with HELPER_CRASHED when the child exits.

- [ ] **Step 4: Add negative cases and commit**

Test mismatched protocol and a 5 ms injected timeout. Then run:

~~~sh
PATH="/Users/passer/.bun/bin:$PATH" bun test test/audio/helper-process.test.ts
git add src/audio/BunAudioHelperProcess.ts test/audio/helper-process.test.ts test/fixtures/fake-audio-helper.ts
git commit -m "feat: add Bun audio helper client"
~~~

### Task 4: Build macOS Swift AudioHelper

**Files:**
- Create: native/AudioHelper.swift, native/AudioHelper.Info.plist, scripts/build-native.sh
- Create: test/audio-helper-build.test.ts

**Consumes:** stdin JSONL commands.

**Produces:** raw 640-byte PCM stdout and JSONL ready/response/event stderr.

- [ ] **Step 1: Write a build and hello test**

~~~ts
test("AudioHelper builds and announces protocol version 1", async () => {
  const build = Bun.spawn(["zsh", "scripts/build-native.sh"]);
  expect(await build.exited).toBe(0);
  const helper = Bun.spawn(["native/AudioHelper.app/Contents/MacOS/AudioHelper"], { stdin: "pipe", stderr: "pipe" });
  helper.stdin.write('{"id":"1","type":"hello"}\n');
  expect(await firstJsonLine(helper.stderr)).toMatchObject({ type: "ready", protocolVersion: 1 });
  helper.kill();
});
~~~

- [ ] **Step 2: Confirm failure**

Run: PATH="/Users/passer/.bun/bin:$PATH" bun test test/audio-helper-build.test.ts

Expected: FAIL because AudioHelper does not exist.

- [ ] **Step 3: Implement native command handling**

Use Codable JSONL records. Implement get_permission and request_permission with AVCaptureDevice audio authorization; implement get_devices and get_default_device using AVCaptureDevice audio devices; treat default as a valid opaque device ID; return DEVICE_NOT_FOUND for unknown IDs. Implement idempotent start, stop, and shutdown.

- [ ] **Step 4: Implement normalized capture**

Use AVAudioEngine inputNode.installTap and AVAudioConverter with pcmFormatInt16, 16000 sample rate, one interleaved channel. Accumulate converted bytes and write only complete 640-byte slices to FileHandle.standardOutput. Write every control record only to FileHandle.standardError.

- [ ] **Step 5: Build, verify, and commit**

The build script compiles both existing LocationHelper and AudioHelper, writes AudioHelper.Info.plist with NSMicrophoneUsageDescription, and ad-hoc signs the bundle.

~~~sh
PATH="/Users/passer/.bun/bin:$PATH" bun test test/audio-helper-build.test.ts
git add native/AudioHelper.swift native/AudioHelper.Info.plist scripts/build-native.sh test/audio-helper-build.test.ts
git commit -m "feat: add macOS AudioHelper"
~~~

### Task 5: Expose AudioManager

**Files:**
- Create: src/audio/AudioManager.ts
- Create: test/audio/audio-manager.test.ts

**Consumes:** BunAudioHelperProcess and PCMFrameParser.

**Produces:** initialize, getDevices, getDefaultDevice, selectDevice, getPermissionStatus, requestPermission, start, stop, shutdown, onAudio, onError, and getStatus.

- [ ] **Step 1: Write a failing frame test**

~~~ts
test("forwards complete native frames to listeners", async () => {
  const manager = new AudioManager({ helper: fakeHelper([new Uint8Array(960), new Uint8Array(320)]) });
  const sizes: number[] = [];
  manager.onAudio((frame) => sizes.push(frame.data.byteLength));
  await manager.initialize();
  await manager.start();
  expect(sizes).toEqual([640, 640]);
});
~~~

- [ ] **Step 2: Confirm failure and implement**

Run: PATH="/Users/passer/.bun/bin:$PATH" bun test test/audio/audio-manager.test.ts

Implement selectedDevice (default initially), capture state, listeners, and reader consumption. Send start with selected device; parse audio chunks; emit { data, sequence } per frame. Cancel the reader before idempotent stop/shutdown. Convert helper exits into HELPER_CRASHED errors.

- [ ] **Step 3: Test device/permission/error paths and commit**

Assert that selectDevice forwards the original opaque ID, permission is unchanged, and a helper exit invokes onError with HELPER_CRASHED.

~~~sh
PATH="/Users/passer/.bun/bin:$PATH" bun test test/audio/audio-manager.test.ts
git add src/audio/AudioManager.ts test/audio/audio-manager.test.ts
git commit -m "feat: expose AudioManager"
~~~

### Task 6: Replace the recorder and migrate application source to TypeScript

**Files:**
- Rename: src/index.js, src/asr/streaming.js, src/tts/streaming.js, src/coffee-agent.js, src/location.js, src/ui.js to .ts
- Delete: src/recorder.js, test/recorder.test.mjs
- Rename/modify: all test/*.test.mjs to .test.ts
- Modify: README.md, .env.example
- Create: test/index-audio-bridge.test.ts

**Consumes:** AudioManager.onAudio((frame) => session?.write(frame.data)).

**Produces:** existing terminal flow driven by native PCM, not FFmpeg.

- [ ] **Step 1: Write a failing integration test**

~~~ts
test("writes native PCM frames to the active ASR session", async () => {
  const writes: Uint8Array[] = [];
  const bridge = createRecorderBridge(fakeAudio, { write: (frame) => writes.push(frame) });
  await bridge.start();
  fakeAudio.emit(new Uint8Array(640));
  expect(writes).toHaveLength(1);
});
~~~

- [ ] **Step 2: Confirm failure and replace StreamRecorder**

Run: PATH="/Users/passer/.bun/bin:$PATH" bun test test/index-audio-bridge.test.ts

Create createRecorderBridge in index.ts. It starts AudioManager only after the ASR session starts; appends frame data for retry; stops audio before session.finish. Request permission before enabling raw input. Start recording still stops TTS; quit calls audio.shutdown. Delete AUDIO_DEVICE and all FFmpeg microphone checks.

- [ ] **Step 3: Convert remaining source and tests**

Convert each listed JavaScript file to TypeScript with the same exports and import paths. Convert each test to bun:test. Preserve ASR, TTS, MCP, UI, and location behavior; use Bun.spawn for any newly touched child process.

- [ ] **Step 4: Full verification and commit**

~~~sh
PATH="/Users/passer/.bun/bin:$PATH" bun run build:native
PATH="/Users/passer/.bun/bin:$PATH" bun test
PATH="/Users/passer/.bun/bin:$PATH" bun --check src/index.ts
git diff --check
git add src test .env.example README.md package.json bun.lock tsconfig.json scripts native
git commit -m "feat: capture audio with native helper"
~~~

Expected: all tests pass; both Swift helpers build; Space-to-Enter real microphone smoke test produces an ASR result without FFmpeg microphone capture.
