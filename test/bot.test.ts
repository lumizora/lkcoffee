import assert from "node:assert/strict";
import test from "node:test";
import { createBotHandler } from "../src/bot";

test("bot uses the voice transcript and returns CoffeeAgent output", async () => {
  const asked: string[] = [];
  const handle = createBotHandler({
    ask: async (userId, text) => {
      asked.push(`${userId}:${text}`);
      return { text: "为你找到附近门店。" };
    },
  });

  assert.equal(
    await handle({ fromUserId: "wx-1", contextToken: "ctx-1", voice: { transcript: "附近门店" } }),
    "为你找到附近门店。",
  );
  assert.deepEqual(asked, ["wx-1:附近门店"]);
});

test("bot transcribes PCM when iLink does not provide text", async () => {
  const handle = createBotHandler({
    ask: async (_userId, text) => ({ text }),
    transcribe: async (pcm) => {
      assert.deepEqual(pcm, Buffer.from("pcm"));
      return "一杯冰美式";
    },
  });

  assert.equal(await handle({ fromUserId: "wx-1", voice: { pcm: Buffer.from("pcm") } }), "一杯冰美式");
});

test("bot includes the payment link in its text reply", async () => {
  const handle = createBotHandler({
    ask: async () => ({ text: "订单已创建。", qrCodeUrl: "https://pay.example.test/order" }),
  });

  assert.equal(await handle({ fromUserId: "wx-1", text: "确认下单" }), "订单已创建。\n支付链接：https://pay.example.test/order");
});
