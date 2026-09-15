import assert from "node:assert/strict";
import test from "node:test";
import { CoffeeAgent } from "../src/coffee-agent";

type ModelRequest = {
  messages: Array<{ role: string; content?: string | null; reasoning_content?: string }>;
  reasoning_effort?: string;
  thinking?: { type: string };
};
type McpRequest = { method: string; params: { name?: string; arguments?: Record<string, unknown> } };
const body = (options?: RequestInit): McpRequest => JSON.parse(String(options?.body));

test("coffee agent turns an MCP tool result into a spoken reply", async () => {
  let modelCalls = 0;
  const client = { chat: { completions: { create: async (request: ModelRequest) => {
    modelCalls += 1;
    if (modelCalls === 1) {
      assert.equal(request.messages.at(-1)?.content, "附近有什么瑞幸？");
      assert.equal(request.messages.some((message) => message.content?.includes("31.2")), true);
      return { choices: [{ message: { tool_calls: [{
        id: "call-1", type: "function", function: { name: "queryShopList", arguments: '{"latitude":31.2,"longitude":121.5}' },
      }], reasoning_content: "需要查询附近门店" } }] };
    }
    assert.equal(request.messages.at(-1)?.role, "tool");
    assert.equal(request.messages.some((message) => message.reasoning_content === "需要查询附近门店"), true);
    return { choices: [{ message: { content: "附近有 1 家瑞幸，请选择门店。" } }] };
  } } } };
  const fetch = async (_url: string, options?: RequestInit) => {
    const request = body(options);
    if (request.method === "tools/list") return new Response(JSON.stringify({ result: { tools: [{
      name: "queryShopList", description: "查询门店", inputSchema: { type: "object", properties: {} },
    }] } }));
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "门店 A" }] } }));
  };
  const agent = new CoffeeAgent({ client: client as never, fetch, token: "test-token", location: { latitude: 31.2, longitude: 121.5 } });

  assert.equal((await agent.ask("附近有什么瑞幸？")).text, "附近有 1 家瑞幸，请选择门店。");
});

test("coffee agent requires a later explicit confirmation after previewing a selected store", async () => {
  let modelCalls = 0;
  let orderCreated = false;
  const client = { chat: { completions: { create: async (request: ModelRequest) => {
    modelCalls += 1;
    if (modelCalls === 1) return { choices: [{ message: { tool_calls: [{
      id: "preview-1", type: "function", function: { name: "previewOrder", arguments: '{"deptId":1,"productList":[]}' },
    }, {
      id: "create-1", type: "function", function: { name: "createOrder", arguments: '{"deptId":1,"productList":[]}' },
    }] } }] };
    if (modelCalls === 2) {
      return { choices: [{ message: { content: "鲁商中心店，橙 C 美式大杯冰，实付 13.9 元。请回复“确认下单”。" } }] };
    }
    if (modelCalls === 4) {
      return { choices: [{ message: { content: "订单已创建，请扫码支付。" } }] };
    }
    return { choices: [{ message: { tool_calls: [{
      id: "create-2", type: "function", function: { name: "createOrder", arguments: '{"deptId":1,"productList":[]}' },
    }] } }] };
  } } } };
  const calledTools: string[] = [];
  const fetch = async (_url: string, options?: RequestInit) => {
    const request = body(options);
    if (request.method === "tools/list") return new Response(JSON.stringify({ result: { tools: ["previewOrder", "createOrder"].map((name) => ({
      name, description: name, inputSchema: { type: "object", properties: {} },
    })) } }));
    calledTools.push(request.params.name!);
    if (request.params.name === "previewOrder") return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "预览成功" }] } }));
    orderCreated = true;
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ orderId: "order-1", payOrderQrCodeUrl: "https://pay.example/qr" }) }] } }));
  };
  const agent = new CoffeeAgent({ client: client as never, fetch, token: "test-token" });

  const preview = await agent.ask("鲁商");
  assert.equal(preview.text, "鲁商中心店，橙 C 美式大杯冰，实付 13.9 元。请回复“确认下单”。");
  assert.deepEqual(calledTools, ["previewOrder"]);
  assert.equal(orderCreated, false);

  const paid = await agent.ask("确认下单");
  assert.equal(orderCreated, true);
  assert.equal(modelCalls, 4);
  assert.equal(paid.qrCodeUrl, "https://pay.example/qr");
});

test("coffee agent sends the selected DeepSeek thinking effort", async () => {
  const requests: ModelRequest[] = [];
  const client = { chat: { completions: { create: async (request: ModelRequest) => {
    requests.push(request);
    return { choices: [{ message: { content: "好的。" } }] };
  } } } };
  const fetch = async (_url: string, options?: RequestInit) => {
    const request = body(options);
    assert.equal(request.method, "tools/list");
    return new Response(JSON.stringify({ result: { tools: [] } }));
  };
  const agent = new CoffeeAgent({ client: client as never, fetch, token: "test-token" });

  await agent.ask("你好");
  await agent.ask("再想想", "max");

  assert.equal(requests[0].reasoning_effort, "high");
  assert.equal(requests[1].reasoning_effort, "max");
  assert.deepEqual(requests[0].thinking, { type: "enabled" });
});

test("coffee agent shows the final price without creating when the user asks for it", async () => {
  let modelCalls = 0;
  let orderCreated = false;
  const client = { chat: { completions: { create: async (request: ModelRequest) => {
    modelCalls += 1;
    if (modelCalls === 1) return { choices: [{ message: { tool_calls: [{
      id: "preview-1", type: "function", function: { name: "previewOrder", arguments: '{"deptId":1,"productList":[]}' },
    }] } }] };
    if (modelCalls === 2) return { choices: [{ message: { tool_calls: [{
      id: "create-1", type: "function", function: { name: "createOrder", arguments: '{"deptId":1,"productList":[]}' },
    }] } }] };
    assert.match(request.messages.at(-1)?.content ?? "", /只查看最终价格/);
    return { choices: [{ message: { content: "实际到手价为13.9元。" } }] };
  } } } };
  const fetch = async (_url: string, options?: RequestInit) => {
    const request = body(options);
    if (request.method === "tools/list") return new Response(JSON.stringify({ result: { tools: ["previewOrder", "createOrder"].map((name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } })) } }));
    if (request.params.name === "previewOrder") return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "预览成功" }] } }));
    orderCreated = true;
    return new Response(JSON.stringify({ result: {} }));
  };
  const agent = new CoffeeAgent({ client: client as never, fetch, token: "test-token" });

  const preview = await agent.ask("可以，然后看一下实际到手价");
  assert.equal(preview.text, "实际到手价为13.9元。");
  assert.equal(orderCreated, false);
});

test("coffee agent executes an explicit order cancellation", async () => {
  let cancelled = false;
  const client = { chat: { completions: { create: async (request: ModelRequest) => {
    if (request.messages.at(-1)?.role === "tool") {
      return { choices: [{ message: { content: "订单已取消。" } }] };
    }
    return { choices: [{ message: { tool_calls: [{
      id: "cancel-1", type: "function", function: { name: "cancelOrder", arguments: '{"orderId":"order-1"}' },
    }] } }] };
  } } } };
  const fetch = async (_url: string, options?: RequestInit) => {
    const request = body(options);
    if (request.method === "tools/list") {
      const tools = [{ name: "cancelOrder", description: "取消订单", inputSchema: { type: "object", properties: { orderId: { type: "string" } } } }];
      return new Response(JSON.stringify({ result: { tools } }));
    }
    assert.equal(request.params.name, "cancelOrder");
    assert.equal(request.params.arguments?.orderId, "order-1");
    cancelled = true;
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "取消成功" }] } }));
  };
  const agent = new CoffeeAgent({ client: client as never, fetch, token: "test-token" });

  assert.equal((await agent.ask("取消这个订单")).text, "订单已取消。");
  assert.equal(cancelled, true);
});

test("coffee agent reports the MCP cancellation failure reason", async () => {
  let modelCalls = 0;
  const client = { chat: { completions: { create: async (_request: ModelRequest) => {
    modelCalls += 1;
    if (modelCalls === 1) return { choices: [{ message: { tool_calls: [{
      id: "cancel-1", type: "function", function: { name: "cancelOrder", arguments: '{"orderId":"order-1"}' },
    }] } }] };
    return { choices: [{ message: { content: "取消失败。" } }] };
  } } } };
  const fetch = async (_url: string, options?: RequestInit) => {
    const request = body(options);
    if (request.method === "tools/list") {
      const tools = [{ name: "cancelOrder", description: "取消订单", inputSchema: { type: "object", properties: { orderId: { type: "string" } } } }];
      return new Response(JSON.stringify({ result: { tools } }));
    }
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: '{"code":1000,"msg":"订单已制作，无法取消","success":false}' }] } }));
  };
  const agent = new CoffeeAgent({ client: client as never, fetch, token: "test-token" });

  assert.equal((await agent.ask("取消这个订单")).text, "取消订单失败：订单已制作，无法取消");
  assert.equal(modelCalls, 1);
});
