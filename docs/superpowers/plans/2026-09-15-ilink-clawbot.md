# iLink ClawBot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing Luckin Coffee agent as a WeChat iLink ClawBot without a new QR login.

**Architecture:** A small `src/ilink/` transport owns persisted-session loading, protocol requests, long polling, and text replies. `src/bot.ts` creates one `CoffeeAgent` per WeChat user, uses iLink voice transcripts when supplied, and sends replies using the inbound `context_token`. Voice without a transcript is not processed.

**Tech Stack:** Bun, TypeScript, native `fetch`/`crypto`/`fs`, existing `ws`, DeepSeek, Luckin MCP, iLink HTTP API.

**Spec:** `docs/superpowers/specs/2026-09-15-ilink-clawbot-design.md`

## Global Constraints

- Add no package dependency.
- Read the existing session from `/Users/passer/Downloads/bun-ilink-clawbot-demo/.data` by default; allow `ILINK_DATA_DIR` to override it.
- Never copy, print, stage, or commit bot tokens, cursor values, decrypted media, or `.env` contents.
- Do not run Ink, macOS microphone/location code, or TTS from `bun run bot`.
- Preserve the inbound `context_token` for each reply and keep processing subsequent messages after a per-message failure.

---

### Task 1: Add the minimal iLink transport

**Files:**
- Create: `src/ilink/types.ts`
- Create: `src/ilink/config.ts`
- Create: `src/ilink/http.ts`
- Create: `src/ilink/storage.ts`
- Create: `src/ilink/media.ts`
- Create: `src/ilink/client.ts`
- Test: `test/ilink-client.test.ts`

**Interfaces:**
- Produces: `loadIlinkAccount(): Promise<IlinkAccount>`, `listenIlink(account, onMessage, signal): Promise<void>`, and `sendIlinkText(account, message, text): Promise<void>`.
- Consumes: `onMessage(message: IlinkMessage): Promise<string | undefined>`; `IlinkMessage` has `fromUserId`, `contextToken`, `text?`, and `voice?`.
- Produces: `voice.pcm?: Buffer`, always 16 kHz mono signed 16-bit PCM when a downloadable voice file can be converted.

- [x] **Step 1: Write the failing transport test**

```ts
test("iLink dispatches text and replies with its context token", async () => {
  const requests: Array<{ body: any }> = [];
  const fetch = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); requests.push({ body });
    if (body.get_updates_buf !== undefined) return new Response(JSON.stringify({
      get_updates_buf: "next", msgs: [{ from_user_id: "wx-1", context_token: "ctx-1", item_list: [{ type: 1, text_item: { text: "附近门店" } }] }],
    }));
    return new Response(JSON.stringify({ ret: 0 }));
  };
  await pollOnce(account, async ({ text }) => { assert.equal(text, "附近门店"); return "这里有三家门店。"; }, fetch);
  assert.equal(requests.at(-1)?.body.msg.context_token, "ctx-1");
  assert.equal(requests.at(-1)?.body.msg.item_list[0].text_item.text, "这里有三家门店。");
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun test test/ilink-client.test.ts`

Expected: FAIL because `pollOnce` and iLink transport modules do not exist.

- [x] **Step 3: Implement the transport with only the required protocol paths**

```ts
export async function pollOnce(account: IlinkAccount, onMessage: OnMessage, fetcher = fetch) {
  const response = await postIlink(account, "ilink/bot/getupdates", { get_updates_buf: await loadCursor(), base_info: baseInfo() }, fetcher);
  await saveCursor(response.get_updates_buf ?? "");
  for (const message of response.msgs ?? []) {
    const text = textFrom(message); const voice = await voiceFrom(message);
    if (!message.from_user_id || (!text && !voice)) continue;
    const reply = await onMessage({ fromUserId: message.from_user_id, contextToken: message.context_token, text, voice });
    if (reply) await sendIlinkText(account, message, reply, fetcher);
  }
}
```

Implement `notifystart`/`notifystop`, bounded retry backoff (1s to 10s), token-expiry error reporting, authorization headers, 30-second media download timeout, 100 MiB media limit, AES-128-ECB decryption, and `ffmpeg -v error -i pipe:0 -ar 16000 -ac 1 -f s16le pipe:1` conversion. Store only the cursor in `${ILINK_DATA_DIR}/state.json`; read but never write the account file.

- [x] **Step 4: Run focused checks**

Run: `bun test test/ilink-client.test.ts && bun run typecheck`

Expected: PASS.

- [x] **Step 5: Commit the transport**

```bash
git add src/ilink test/ilink-client.test.ts
git commit -m "feat: add iLink bot transport"
```

### Task 2: Let the streaming ASR transcribe converted PCM

**Files:**
- Modify: `src/asr/streaming.ts`
- Modify: `test/streaming-asr.test.ts`

**Interfaces:**
- Produces: `VolcengineStreamingASR.transcribePcm(audio: Uint8Array): Promise<ASRTranscript>`.
- Consumes: 16 kHz, mono, 16-bit signed little-endian PCM from `IlinkMessage.voice.pcm`.

> **Scope amendment (2026-09-15):** Per user direction, do not implement voice-media download, decoding, or ASR fallback. Task 2 and every media/PCM instruction below are superseded; only iLink-provided voice transcripts are handled.

- [ ] **Step 1: Write the failing ASR test**

```ts
test("transcribes one PCM buffer through the normal streaming session", async () => {
  const asr = new VolcengineStreamingASR({ apiKey: "test-key", connect: fakeConnect });
  assert.equal((await asr.transcribePcm(Buffer.from([1, 2, 3]))).text, "确认下单");
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `bun test test/streaming-asr.test.ts`

Expected: FAIL because `transcribePcm` does not exist.

- [x] **Step 3: Add the one-method adapter**

```ts
async transcribePcm(audio: Uint8Array): Promise<ASRTranscript> {
  const session = await this.start();
  session.write(audio);
  return session.finish();
}
```

- [x] **Step 4: Run focused checks**

Run: `bun test test/streaming-asr.test.ts && bun run typecheck`

Expected: PASS.

- [x] **Step 5: Commit the adapter**

```bash
git add src/asr/streaming.ts test/streaming-asr.test.ts
git commit -m "feat: accept PCM buffers in streaming ASR"
```

### Task 3: Add the ClawBot application bridge and command

**Files:**
- Create: `src/bot.ts`
- Modify: `package.json`
- Modify: `README.md`
- Test: `test/bot.test.ts`

**Interfaces:**
- Consumes: `listenIlink`, `VolcengineStreamingASR.transcribePcm`, and `CoffeeAgent.ask`.
- Produces: `bun run bot`, which has no Ink UI and stops iLink cleanly on SIGINT/SIGTERM.

- [x] **Step 1: Write the failing bridge test**

```ts
test("bot uses the voice transcript and sends CoffeeAgent output", async () => {
  const asked: string[] = [];
  const handle = createBotHandler({ ask: async (text) => { asked.push(text); return { text: "为你找到附近门店。" }; } });
  assert.equal(await handle({ fromUserId: "wx-1", contextToken: "ctx-1", voice: { transcript: "附近门店" } }), "为你找到附近门店。");
  assert.deepEqual(asked, ["附近门店"]);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `bun test test/bot.test.ts`

Expected: FAIL because `createBotHandler` does not exist.

- [x] **Step 3: Implement the bridge and command**

```ts
export function createBotHandler(deps: { ask: (userId: string, text: string) => Promise<{ text: string }> }) {
  return async (message: IlinkMessage) => {
    const text = message.text ?? message.voice?.transcript ?? (message.voice?.pcm ? (await asr.transcribePcm(message.voice.pcm)).text : "");
    return text ? (await deps.ask(message.fromUserId, text)).text : "收到语音，但没有可用的转写内容。";
  };
}
```

Maintain `Map<string, CoffeeAgent>` in the executable, so separate WeChat users do not share order conversation history. Add `"bot": "bun --env-file=.env src/bot.ts"`; document required DeepSeek/Luckin variables, default session path, `ILINK_DATA_DIR`, and `bun run bot`.

- [x] **Step 4: Run focused checks**

Run: `bun test test/bot.test.ts && bun run typecheck`

Expected: PASS.

- [x] **Step 5: Commit the application bridge**

```bash
git add src/bot.ts package.json README.md test/bot.test.ts
git commit -m "feat: run coffee agent as iLink bot"
```

### Task 4: Verify end to end with the existing login session

**Files:**
- Modify: none

**Interfaces:**
- Consumes: the existing `/Users/passer/Downloads/bun-ilink-clawbot-demo/.data/account.json` session and live iLink service.
- Produces: evidence that the bot starts without QR login and replies to one WeChat text message.

- [x] **Step 1: Run the full local suite**

Run: `bun test && bun run typecheck`

Expected: PASS with no regressions.

- [x] **Step 2: Start the authenticated bot**

Run: `bun run bot`

Expected: logs `notifystart` and long-poll startup without presenting a QR code or exposing account values.

- [ ] **Step 3: Send one WeChat text and confirm its reply**

Send: `附近有什么瑞幸？`

Expected: the process logs receipt without token values, calls the agent, and the same WeChat chat receives a CoffeeAgent response.

- [x] **Step 4: Stop cleanly**

Run: press `Ctrl+C`

Expected: `notifystop` is attempted and the process exits.

## Self-review

- Spec coverage: Task 1 covers session reuse, iLink lifecycle, context-token replies, media limits, and resilient polling; Task 2 covers ASR fallback; Task 3 covers CoffeeAgent reuse, user isolation, no desktop services, command, and documentation; Task 4 covers authenticated end-to-end validation.
- Placeholder scan: no deferred requirements or undefined interfaces remain.
- Type consistency: `IlinkMessage` is the transport-to-bridge type; `transcribePcm` receives its `voice.pcm`; bridge handler returns the string consumed by `sendIlinkText`.
