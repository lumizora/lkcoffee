import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadIlinkAccount, saveIlinkAccount } from "../src/ilink/storage";

test("saves the iLink account privately", async () => {
  const root = await mkdtemp(join(tmpdir(), "lkcoffee-auth-"));
  const account = { botToken: "secret", botId: "bot", baseUrl: "https://ilinkai.weixin.qq.com" };

  try {
    await saveIlinkAccount(account, root);
    assert.deepEqual(await loadIlinkAccount(root), account);
    assert.equal((await stat(join(root, "account.json"))).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
