import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import qrcode from "qrcode-terminal";
import { botType, loginBaseUrl } from "./config";
import { getIlink, postIlinkUrl } from "./http";
import { saveIlinkAccount } from "./storage";
import type { IlinkAccount } from "./types";

type QrStatus = {
  status: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect" | "need_verifycode" | "verify_code_blocked" | "binded_redirect";
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
};

function normalizeBaseUrl(value?: string): string {
  if (!value) return loginBaseUrl;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

async function verifyCode(): Promise<string> {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    return (await prompt.question("请输入微信端显示的配对数字：")).trim();
  } finally {
    prompt.close();
  }
}

async function requestQr() {
  return JSON.parse(await postIlinkUrl(loginBaseUrl, `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, { local_token_list: [] })) as { qrcode: string; qrcode_img_content: string };
}

export async function loginIlink(): Promise<IlinkAccount> {
  let qr = await requestQr();
  let baseUrl = loginBaseUrl;
  let code: string | undefined;
  const print = () => qrcode.generate(qr.qrcode_img_content, { small: true });
  print();
  while (true) {
    let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qr.qrcode)}`;
    if (code) endpoint += `&verify_code=${encodeURIComponent(code)}`;
    const status = JSON.parse(await getIlink(baseUrl, endpoint)) as QrStatus;
    switch (status.status) {
      case "wait":
        break;
      case "scaned":
        code = undefined;
        break;
      case "need_verifycode":
        code = await verifyCode();
        continue;
      case "verify_code_blocked":
        throw new Error("iLink 配对码多次错误，请稍后重试。");
      case "scaned_but_redirect":
        if (status.redirect_host) baseUrl = normalizeBaseUrl(status.redirect_host);
        break;
      case "expired":
        qr = await requestQr();
        baseUrl = loginBaseUrl;
        code = undefined;
        print();
        break;
      case "binded_redirect":
        throw new Error("该 ClawBot 已绑定，但本机没有可用登录信息。");
      case "confirmed": {
        if (!status.bot_token || !status.ilink_bot_id) throw new Error("iLink 登录响应缺少账户信息。");
        const account = {
          botToken: status.bot_token,
          botId: status.ilink_bot_id,
          userId: status.ilink_user_id,
          baseUrl: normalizeBaseUrl(status.baseurl),
          savedAt: new Date().toISOString(),
        };
        await saveIlinkAccount(account);
        return account;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
