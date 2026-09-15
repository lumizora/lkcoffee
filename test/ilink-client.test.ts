import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("iLink dispatches text and replies with its context token", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "lkcoffee-ilink-"));
  process.env.ILINK_DATA_DIR = dataDir;
  const { pollOnce } = await import("../src/ilink/client");
  const requests: Array<{ url: string; body: Record<string, any> }> = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    requests.push({ url, body });
    if (url.includes("getupdates")) return new Response(JSON.stringify({
      get_updates_buf: "next",
      msgs: [{
        from_user_id: "wx-1",
        context_token: "ctx-1",
        item_list: [{ type: 1, text_item: { text: "附近门店" } }],
      }],
    }));
    return new Response(JSON.stringify({ ret: 0 }));
  };

  try {
    await pollOnce(
      { botToken: "test-token", botId: "bot-1", baseUrl: "https://example.test" },
      async ({ text }) => {
        assert.equal(text, "附近门店");
        return "这里有三家门店。";
      },
      fetch,
    );
    assert.equal(requests.at(-1)?.body.msg.context_token, "ctx-1");
    assert.equal(requests.at(-1)?.body.msg.item_list[0].text_item.text, "这里有三家门店。");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("iLink passes a voice transcript to the handler", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "lkcoffee-ilink-"));
  process.env.ILINK_DATA_DIR = dataDir;
  const { pollOnce } = await import("../src/ilink/client");
  let calls = 0;
  const fetch = async (url: string) => new Response(JSON.stringify(url.includes("getupdates") ? {
    get_updates_buf: "next",
    msgs: [{
      from_user_id: "wx-1",
      context_token: "ctx-1",
      item_list: [{ type: 3, voice_item: { text: "帮我点一杯美式" } }],
    }],
  } : { ret: 0 }));

  try {
    await pollOnce(
      { botToken: "test-token", botId: "bot-1", baseUrl: "https://example.test" },
      async ({ voice }) => {
        calls += 1;
        assert.equal(voice?.transcript, "帮我点一杯美式");
        return undefined;
      },
      fetch,
    );
    assert.equal(calls, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
