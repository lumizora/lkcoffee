import { baseInfo } from "./config";
import { postIlink, type IlinkFetch } from "./http";
import { downloadVoice } from "./media";
import { loadCursor, saveCursor } from "./storage";
import type { GetUpdatesResponse, IlinkAccount, IlinkMessage, IlinkRawMessage, OnIlinkMessage } from "./types";

const userMessage = 1;
const textItem = 1;
const voiceItem = 3;

function textFrom(message: IlinkRawMessage): string | undefined {
  const text = (message.item_list ?? [])
    .filter((item) => item.type === textItem)
    .map((item) => item.text_item?.text?.trim())
    .filter(Boolean)
    .join("\n");
  return text || undefined;
}

async function voiceFrom(message: IlinkRawMessage, fetcher: IlinkFetch): Promise<IlinkMessage["voice"]> {
  const voice = (message.item_list ?? []).find((item) => item.type === voiceItem)?.voice_item;
  if (!voice) return undefined;
  const transcript = voice.text?.trim();
  if (transcript) return { transcript };
  return voice.media ? downloadVoice(voice, fetcher) : undefined;
}

function check(response: GetUpdatesResponse): GetUpdatesResponse {
  if (!response.ret) return response;
  if (response.errcode === -14) throw new Error("iLink token 已失效，请在演示项目重新登录。");
  throw new Error(`iLink getupdates 失败：${response.errmsg ?? response.ret}`);
}

export async function sendIlinkText(account: IlinkAccount, message: IlinkMessage, text: string, fetcher: IlinkFetch = fetch): Promise<void> {
  const response = JSON.parse(await postIlink(account, "ilink/bot/sendmessage", {
    msg: {
      from_user_id: "",
      to_user_id: message.fromUserId,
      client_id: `voice-coffee:${Date.now()}-${crypto.randomUUID()}`,
      message_type: 2,
      message_state: 2,
      context_token: message.contextToken,
      item_list: [{ type: textItem, text_item: { text } }],
    },
    base_info: baseInfo(),
  }, fetcher)) as { ret?: number; errmsg?: string };
  if (response.ret) throw new Error(`iLink sendmessage 失败：${response.errmsg ?? response.ret}`);
}

export async function pollOnce(account: IlinkAccount, onMessage: OnIlinkMessage, fetcher: IlinkFetch = fetch): Promise<void> {
  const response = check(JSON.parse(await postIlink(account, "ilink/bot/getupdates", {
    get_updates_buf: await loadCursor(),
    base_info: baseInfo(),
  }, fetcher)) as GetUpdatesResponse);
  if (response.get_updates_buf !== undefined) await saveCursor(response.get_updates_buf);
  for (const raw of response.msgs ?? []) {
    const text = textFrom(raw);
    const voice = await voiceFrom(raw, fetcher);
    if ((raw.message_type !== undefined && raw.message_type !== userMessage) || !raw.from_user_id || (!text && !voice)) continue;
    try {
      const message = { fromUserId: raw.from_user_id, contextToken: raw.context_token, text, voice };
      const reply = await onMessage(message);
      if (reply) await sendIlinkText(account, message, reply, fetcher);
    } catch (error) {
      console.error("[iLink] 消息处理失败：", error instanceof Error ? error.message : String(error));
    }
  }
}

export async function notify(account: IlinkAccount, action: "notifystart" | "notifystop", fetcher: IlinkFetch = fetch): Promise<void> {
  const response = JSON.parse(await postIlink(account, `ilink/bot/msg/${action}`, { base_info: baseInfo() }, fetcher)) as { ret?: number; errmsg?: string };
  if (response.ret) throw new Error(`iLink ${action} 失败：${response.errmsg ?? response.ret}`);
}

export async function listenIlink(account: IlinkAccount, onMessage: OnIlinkMessage, signal: AbortSignal): Promise<void> {
  await notify(account, "notifystart");
  let delay = 1000;
  try {
    while (!signal.aborted) {
      try {
        await pollOnce(account, onMessage);
        delay = 1000;
      } catch (error) {
        console.error("[iLink] 轮询失败：", error instanceof Error ? error.message : String(error));
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 10_000);
      }
    }
  } finally {
    await notify(account, "notifystop").catch(() => {});
  }
}
