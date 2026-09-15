import { CoffeeAgent } from "./coffee-agent";
import { loginIlink } from "./ilink/auth";
import { listenIlink } from "./ilink/client";
import { loadIlinkAccount } from "./ilink/storage";
import { locate, type Location } from "./location";
import type { IlinkMessage } from "./ilink/types";
import type { IlinkAccount } from "./ilink/types";

type AgentReply = { text: string; qrCodeUrl?: string };
type BotDependencies = {
  ask: (userId: string, text: string) => Promise<AgentReply>;
};

export function createBotHandler({ ask }: BotDependencies) {
  return async (message: IlinkMessage): Promise<string> => {
    const text = message.text ?? message.voice?.transcript ?? "";
    if (!text) return "收到语音，但没有可用的转写内容。";
    const reply = await ask(message.fromUserId, text);
    return reply.qrCodeUrl ? `${reply.text}\n支付链接：${reply.qrCodeUrl}` : reply.text;
  };
}

export async function ensureIlinkAccount(load: () => Promise<IlinkAccount | undefined>, login: () => Promise<IlinkAccount>): Promise<IlinkAccount> {
  return await load() ?? login();
}

export async function optionalLocation(getLocation: () => Promise<Location> = locate): Promise<Location | undefined> {
  try { return await getLocation(); } catch { return undefined; }
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const token = process.env.LUCKIN_MCP_TOKEN;
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY");
  if (!token) throw new Error("缺少 LUCKIN_MCP_TOKEN");
  const account = await ensureIlinkAccount(loadIlinkAccount, loginIlink);
  const location = await optionalLocation();
  const agents = new Map<string, CoffeeAgent>();
  const handler = createBotHandler({
    ask: async (userId, text) => {
      let agent = agents.get(userId);
      if (!agent) {
        agent = new CoffeeAgent({
          apiKey,
          baseURL: process.env.DEEPSEEK_BASE_URL,
          model: process.env.DEEPSEEK_MODEL,
          token,
          url: process.env.LUCKIN_MCP_URL,
          location,
        });
        agents.set(userId, agent);
      }
      return agent.ask(text);
    },
  });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log("[iLink] 登录信息已就绪，正在启动长轮询。");
  await listenIlink(account, handler, controller.signal);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
