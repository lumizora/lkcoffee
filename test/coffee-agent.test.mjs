import assert from "node:assert/strict";
import test from "node:test";
import { CoffeeAgent } from "../src/coffee-agent.js";

test("coffee agent turns an MCP tool result into a spoken reply", async () => {
  let modelCalls = 0;
  const client = { chat: { completions: { create: async (request) => {
    modelCalls += 1;
    if (modelCalls === 1) {
      assert.equal(request.messages.at(-1).content, "附近有什么瑞幸？");
      assert.equal(request.messages.some((message) => message.content?.includes("31.2")), true);
      return { choices: [{ message: { tool_calls: [{
        id: "call-1", type: "function", function: { name: "queryShopList", arguments: '{"latitude":31.2,"longitude":121.5}' },
      }] } }] };
    }
    assert.equal(request.messages.at(-1).role, "tool");
    return { choices: [{ message: { content: "附近有 1 家瑞幸，请选择门店。" } }] };
  } } } };
  const fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.method === "tools/list") return new Response(JSON.stringify({ result: { tools: [{
      name: "queryShopList", description: "查询门店", inputSchema: { type: "object", properties: {} },
    }] } }));
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "门店 A" }] } }));
  };
  const agent = new CoffeeAgent({ client, fetch, token: "test-token", location: { latitude: 31.2, longitude: 121.5 } });

  assert.equal((await agent.ask("附近有什么瑞幸？")).text, "附近有 1 家瑞幸，请选择门店。");
});

test("coffee agent creates the previewed order after one voice confirmation", async () => {
  let modelCalls = 0;
  let orderCreated = false;
  const client = { chat: { completions: { create: async (request) => {
    modelCalls += 1;
    if (modelCalls === 1) return { choices: [{ message: { tool_calls: [{
      id: "preview-1", type: "function", function: { name: "previewOrder", arguments: '{"deptId":1,"productList":[]}' },
    }] } }] };
    if (modelCalls === 3) {
      assert.equal(request.messages.at(-1).role, "tool");
      return { choices: [{ message: { content: "订单已创建，请扫码支付。" } }] };
    }
    if (modelCalls === 4) {
      assert.equal(request.messages.some((message) => message.content?.includes("order-1")), true);
      return { choices: [{ message: { content: "我会查询订单 order-1。" } }] };
    }
    return { choices: [{ message: { tool_calls: [{
      id: "create-1", type: "function", function: { name: "createOrder", arguments: '{"deptId":1,"productList":[]}' },
    }] } }] };
  } } } };
  const fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.method === "tools/list") return new Response(JSON.stringify({ result: { tools: ["previewOrder", "createOrder"].map((name) => ({
      name, description: name, inputSchema: { type: "object", properties: {} },
    })) } }));
    if (request.params.name === "previewOrder") return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "预览成功" }] } }));
    orderCreated = true;
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ orderId: "order-1", payOrderQrCodeUrl: "https://pay.example/qr" }) }] } }));
  };
  const agent = new CoffeeAgent({ client, fetch, token: "test-token" });

  const paid = await agent.ask("确认下单");
  assert.equal(orderCreated, true);
  assert.equal(modelCalls, 3);
  assert.equal(paid.qrCodeUrl, "https://pay.example/qr");
  assert.equal((await agent.ask("查询我的订单")).text, "我会查询订单 order-1。");
});

test("coffee agent shows the final price without creating when the user asks for it", async () => {
  let modelCalls = 0;
  let orderCreated = false;
  const client = { chat: { completions: { create: async (request) => {
    modelCalls += 1;
    if (modelCalls === 1) return { choices: [{ message: { tool_calls: [{
      id: "preview-1", type: "function", function: { name: "previewOrder", arguments: '{"deptId":1,"productList":[]}' },
    }] } }] };
    if (modelCalls === 2) return { choices: [{ message: { tool_calls: [{
      id: "create-1", type: "function", function: { name: "createOrder", arguments: '{"deptId":1,"productList":[]}' },
    }] } }] };
    assert.match(request.messages.at(-1).content, /只查看最终价格/);
    return { choices: [{ message: { content: "实际到手价为13.9元。" } }] };
  } } } };
  const fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.method === "tools/list") return new Response(JSON.stringify({ result: { tools: ["previewOrder", "createOrder"].map((name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } })) } }));
    if (request.params.name === "previewOrder") return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "预览成功" }] } }));
    orderCreated = true;
    return new Response(JSON.stringify({ result: {} }));
  };
  const agent = new CoffeeAgent({ client, fetch, token: "test-token" });

  const preview = await agent.ask("可以，然后看一下实际到手价");
  assert.equal(preview.text, "实际到手价为13.9元。");
  assert.equal(orderCreated, false);
});

test("coffee agent executes an explicit order cancellation", async () => {
  let cancelled = false;
  const client = { chat: { completions: { create: async (request) => {
    if (request.messages.at(-1).role === "tool") {
      return { choices: [{ message: { content: "订单已取消。" } }] };
    }
    return { choices: [{ message: { tool_calls: [{
      id: "cancel-1", type: "function", function: { name: "cancelOrder", arguments: '{"orderId":"order-1"}' },
    }] } }] };
  } } } };
  const fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.method === "tools/list") {
      const tools = [{ name: "cancelOrder", description: "取消订单", inputSchema: { type: "object", properties: { orderId: { type: "string" } } } }];
      return new Response(JSON.stringify({ result: { tools } }));
    }
    assert.equal(request.params.name, "cancelOrder");
    assert.equal(request.params.arguments.orderId, "order-1");
    cancelled = true;
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "取消成功" }] } }));
  };
  const agent = new CoffeeAgent({ client, fetch, token: "test-token" });

  assert.equal((await agent.ask("取消这个订单")).text, "订单已取消。");
  assert.equal(cancelled, true);
});
