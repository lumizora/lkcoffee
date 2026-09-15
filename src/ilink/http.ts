import { randomBytes } from "node:crypto";
import { clientVersion } from "./config";
import type { IlinkAccount } from "./types";

export type IlinkFetch = (input: string, init?: RequestInit) => Promise<Response>;

function headers(token?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "X-WECHAT-UIN": Buffer.from(String(randomBytes(4).readUInt32BE(0))).toString("base64"),
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": String(clientVersion),
  };
}

function url(baseUrl: string, endpoint: string): string {
  return new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

export async function postIlinkUrl(baseUrl: string, endpoint: string, body: unknown, token?: string, fetcher: IlinkFetch = fetch): Promise<string> {
  const response = await fetcher(url(baseUrl, endpoint), {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`iLink 请求失败：${response.status}`);
  return text;
}

export function postIlink(account: IlinkAccount, endpoint: string, body: unknown, fetcher: IlinkFetch = fetch): Promise<string> {
  return postIlinkUrl(account.baseUrl, endpoint, body, account.botToken, fetcher);
}

export async function getIlink(baseUrl: string, endpoint: string, fetcher: IlinkFetch = fetch): Promise<string> {
  const response = await fetcher(url(baseUrl, endpoint), { headers: headers() });
  const text = await response.text();
  if (!response.ok) throw new Error(`iLink 请求失败：${response.status}`);
  return text;
}
