import { randomBytes } from "node:crypto";
import { clientVersion } from "./config";
import type { IlinkAccount } from "./types";

export type IlinkFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function postIlink(account: IlinkAccount, endpoint: string, body: unknown, fetcher: IlinkFetch = fetch): Promise<string> {
  const url = new URL(endpoint, account.baseUrl.endsWith("/") ? account.baseUrl : `${account.baseUrl}/`).toString();
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      Authorization: `Bearer ${account.botToken}`,
      "X-WECHAT-UIN": Buffer.from(String(randomBytes(4).readUInt32BE(0))).toString("base64"),
      "iLink-App-Id": "bot",
      "iLink-App-ClientVersion": String(clientVersion),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`iLink 请求失败：${response.status}`);
  return text;
}
