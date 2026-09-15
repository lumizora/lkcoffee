import { VolcengineStreamingASR } from "./asr/streaming";
import { CoffeeAgent } from "./coffee-agent";
import { listenIlink } from "./ilink/client";
import { loadIlinkAccount } from "./ilink/storage";
import type { IlinkMessage } from "./ilink/types";

type AgentReply = { text: string; qrCodeUrl?: string };
type BotDependencies = {
  ask: (userId: string, text: string) => Promise<AgentReply>;
  transcribe?: (pcm: Uint8Array) => Promise<string>;
};

export function createBotHandler({ ask, transcribe }: BotDependencies) {
  return async (message: IlinkMessage): Promise<string> => {
    const text = message.text ?? message.voice?.transcript ?? (message.voice?.pcm && transcribe ? await transcribe(message.voice.pcm) : "");
    if (!text) return "收到语音，但没有可用的转写内容。";
    const reply = await ask(message.fromUserId, text);
    return reply.qrCodeUrl ? `${reply.text}\n支付链接：${reply.qrCodeUrl}` : reply.text;
  };
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const token = process.env.LUCKIN_MCP_TOKEN;
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY");
  if (!token) throw new Error("缺少 LUCKIN_MCP_TOKEN");
  const account = await loadIlinkAccount();
  let asr: VolcengineStreamingASR | undefined;
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
        });
        agents.set(userId, agent);
      }
      return agent.ask(text);
    },
    transcribe: async (pcm) => {
      asr ??= new VolcengineStreamingASR({
        apiKey: process.env.VOLCENGINE_API_KEY,
        resourceId: process.env.VOLCENGINE_RESOURCE_ID,
        url: process.env.VOLCENGINE_ASR_URL,
      });
      return (await asr.transcribePcm(pcm)).text;
    },
  });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log("[iLink] 已读取已有登录信息，正在启动长轮询。");
  await listenIlink(account, handler, controller.signal);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
