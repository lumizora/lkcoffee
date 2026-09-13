import OpenAI from "openai";

const mcpUrl = "https://gwmcp.lkcoffee.com/order/user/mcp";
const instructions = "你是瑞幸咖啡语音助手。仅支持到店自取。查询门店后必须请用户确认门店。创建订单前只做一次用户确认：用户确认后调用 previewOrder；最终价格不高于预估价、商品明细一致且优惠券正常时，立即调用 createOrder，不要再次要求确认。若用户本轮要求查看实际到手价或最终价格，只调用 previewOrder 并展示价格，等待用户之后明确说“确认下单”再创建。用户明确要求取消订单时，直接调用 cancelOrder，不要额外要求终端确认。createOrder 必须原样传入 previewOrder 返回的 couponCodeList。不要编造门店、商品、价格或订单状态。回复用于纯文本终端：不要使用 Markdown，不要使用表格、粗体、标题、列表符号或代码标记；用简短自然段输出。";

export class CoffeeAgent {
  constructor({ apiKey, baseURL = "https://api.deepseek.com", model = "DeepSeek-V4.1-Flash", token, url = mcpUrl, location, client, fetch = globalThis.fetch }) {
    if (!token) throw new Error("缺少 LUCKIN_MCP_TOKEN");
    if (!client && !apiKey) throw new Error("缺少 DEEPSEEK_API_KEY");
    this.client = client ?? new OpenAI({ apiKey, baseURL });
    this.model = model;
    this.token = token;
    this.url = url;
    this.fetch = fetch;
    this.messages = [{ role: "system", content: instructions }];
    if (location) this.messages.push({ role: "system", content: `当前用户坐标：纬度 ${location.latitude}，经度 ${location.longitude}。查询附近门店时直接使用这组坐标。` });
    this.previewed = false;
  }

  async ask(text) {
    const tools = await this.listTools();
    this.messages.push({ role: "user", content: text });
    let qrCodeUrl;
    const priceOnly = asksForPrice(text);
    for (let turns = 0; turns < 5; turns += 1) {
      const completion = await this.client.chat.completions.create({ model: this.model, messages: this.messages, tools });
      const message = completion.choices[0].message;
      if (!message.tool_calls?.length) {
        this.messages.push(message);
        return { text: message.content || "请换一种说法。", qrCodeUrl };
      }
      const create = message.tool_calls.find((call) => call.function.name === "createOrder");
      if (create) {
        if (!this.previewed) return { text: "请先确认门店和商品，再预览订单。" };
        if (priceOnly) {
          this.messages.push({ role: "system", content: "用户本轮只查看最终价格。基于 previewOrder 结果报告实际到手价，不要创建订单或调用任何工具。" });
          continue;
        }
      }
      this.messages.push(message);
      for (const call of message.tool_calls) {
        const result = await this.callTool(call.function.name, JSON.parse(call.function.arguments));
        if (call.function.name === "previewOrder") this.previewed = true;
        if (call.function.name === "createOrder") {
          this.previewed = false;
          qrCodeUrl = findQrCode(result);
        }
        this.messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    throw new Error("瑞幸助手调用次数过多");
  }

  async listTools() {
    const response = await this.mcp("tools/list", {});
    return response.result.tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    }));
  }

  callTool(name, arguments_) {
    return this.mcp("tools/call", { name, arguments: arguments_ });
  }

  async mcp(method, params) {
    const response = await this.fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: crypto.randomUUID() }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`瑞幸 MCP 请求失败：${response.status}`);
    const data = body.split("\n").filter((line) => line.startsWith("data:")).at(-1)?.slice(5).trim() || body;
    const result = JSON.parse(data);
    if (result.error) throw new Error(`瑞幸 MCP 错误：${result.error.message}`);
    return result;
  }
}

function findQrCode(value) {
  return findValue(value, "payOrderQrCodeUrl");
}

function asksForPrice(text) {
  return /实际.*(?:到手价|价格|价)|最终(?:到手价|价格|价|应付)|到手价|看看?(?:实际|最终)?价格/.test(text);
}

function findValue(value, key) {
  if (!value || typeof value !== "object") return undefined;
  if (typeof value[key] === "string") return value[key];
  if (Array.isArray(value)) return value.map((item) => findValue(item, key)).find(Boolean);
  for (const item of Object.values(value)) {
    if (typeof item === "string") {
      try { const found = findValue(JSON.parse(item), key); if (found) return found; } catch {}
    } else {
      const found = findValue(item, key);
      if (found) return found;
    }
  }
}
