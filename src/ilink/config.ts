import { homedir } from "node:os";
import { join } from "node:path";

export const dataDir = () => join(homedir(), ".lkcoffee");
export const channelVersion = process.env.ILINK_CHANNEL_VERSION?.trim() || "2.4.8";
export const botAgent = process.env.ILINK_BOT_AGENT?.trim() || "VoiceCoffee/1.0";

export function baseInfo() {
  return { channel_version: channelVersion, bot_agent: botAgent };
}

export const clientVersion = channelVersion.split(".").slice(0, 3).reduce((value, part) => (value << 8) | (Number.parseInt(part, 10) || 0), 0);
