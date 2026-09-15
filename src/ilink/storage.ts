import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./config";
import type { IlinkAccount } from "./types";

const accountPath = () => join(dataDir(), "account.json");
const statePath = () => join(dataDir(), "state.json");

export async function loadIlinkAccount(): Promise<IlinkAccount> {
  try {
    return JSON.parse(await readFile(accountPath(), "utf8")) as IlinkAccount;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`未找到 iLink 登录信息：${accountPath()}`);
    throw error;
  }
}

export async function loadCursor(): Promise<string> {
  try {
    return (JSON.parse(await readFile(statePath(), "utf8")) as { getUpdatesBuf?: string }).getUpdatesBuf ?? "";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export async function saveCursor(getUpdatesBuf: string): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(statePath(), JSON.stringify({ getUpdatesBuf }) + "\n", { mode: 0o600 });
}
