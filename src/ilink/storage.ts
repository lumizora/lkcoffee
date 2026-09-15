import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./config";
import type { IlinkAccount } from "./types";

const accountPath = (root = dataDir()) => join(root, "account.json");
const statePath = (root = dataDir()) => join(root, "state.json");

async function writePrivate(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function loadIlinkAccount(root = dataDir()): Promise<IlinkAccount | undefined> {
  try {
    return JSON.parse(await readFile(accountPath(root), "utf8")) as IlinkAccount;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function saveIlinkAccount(account: IlinkAccount, root = dataDir()): Promise<void> {
  return writePrivate(accountPath(root), account);
}

export async function loadCursor(root = dataDir()): Promise<string> {
  try {
    return (JSON.parse(await readFile(statePath(root), "utf8")) as { getUpdatesBuf?: string }).getUpdatesBuf ?? "";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export function saveCursor(getUpdatesBuf: string, root = dataDir()): Promise<void> {
  return writePrivate(statePath(root), { getUpdatesBuf });
}
