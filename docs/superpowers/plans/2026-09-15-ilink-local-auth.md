# iLink Local Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist iLink Bot authentication under `~/.lkcoffee` and automatically log in only when no local account exists.

**Architecture:** Storage defaults to `join(homedir(), ".lkcoffee")` and saves account/cursor JSON with 0600 permissions. A small QR-login module reuses the demo's verified iLink protocol; the bot resolves the saved account first, falling back to login only on absence.

**Tech Stack:** Bun, TypeScript, native `fs/promises`, `os`, `readline/promises`, existing iLink HTTP helper, `qrcode-terminal`.

**Spec:** `docs/superpowers/specs/2026-09-15-ilink-local-auth-design.md`

## Global Constraints

- Production credentials and cursor live only in `~/.lkcoffee`.
- Account and state files use mode 0600; credentials, QR content and cursor are never logged or committed.
- No external directory fallback, migration, account selection or logout command.
- Existing account must start the bot without requesting a QR login.

---

### Task 1: Move persisted state into the local application directory

**Files:**
- Modify: `src/ilink/config.ts`
- Modify: `src/ilink/storage.ts`
- Modify: `src/ilink/types.ts`
- Test: `test/ilink-storage.test.ts`

**Interfaces:**
- Produces: `dataDir(): string`, `loadIlinkAccount(root?: string): Promise<IlinkAccount | undefined>`, `saveIlinkAccount(account, root?: string): Promise<void>`, `loadCursor(root?: string): Promise<string>`, and `saveCursor(cursor, root?: string): Promise<void>`.
- Consumes: a test-only `root` argument; omitted callers always use `~/.lkcoffee`.

- [x] **Step 1: Write the failing storage test**

```ts
test("saves the iLink account privately", async () => {
  const root = await mkdtemp(join(tmpdir(), "lkcoffee-auth-"));
  await saveIlinkAccount({ botToken: "secret", botId: "bot", baseUrl: "https://ilinkai.weixin.qq.com" }, root);
  assert.deepEqual(await loadIlinkAccount(root), { botToken: "secret", botId: "bot", baseUrl: "https://ilinkai.weixin.qq.com" });
  assert.equal((await stat(join(root, "account.json")).mode & 0o777), 0o600);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun test test/ilink-storage.test.ts`

Expected: FAIL because private account saving does not exist.

- [x] **Step 3: Implement private account persistence**

```ts
const dataDir = () => join(homedir(), ".lkcoffee");

export async function saveIlinkAccount(account: IlinkAccount, root = dataDir()) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "account.json"), JSON.stringify(account) + "\n", { mode: 0o600 });
  await chmod(join(root, "account.json"), 0o600);
}
```

Change missing-account handling to return `undefined`, and make cursor use the same root and permission helper.

- [x] **Step 4: Run focused checks**

Run: `bun test test/ilink-storage.test.ts && bun run typecheck`

Expected: PASS.

- [x] **Step 5: Commit local storage**

```bash
git add src/ilink/config.ts src/ilink/storage.ts src/ilink/types.ts test/ilink-storage.test.ts
git commit -m "feat: store iLink state locally"
```

### Task 2: Add QR login only when local credentials are absent

**Files:**
- Create: `src/ilink/auth.ts`
- Create: `src/ilink/qrcode-terminal.d.ts`
- Modify: `src/ilink/http.ts`
- Modify: `src/bot.ts`
- Modify: `package.json`
- Modify: `README.md`
- Test: `test/bot.test.ts`

**Interfaces:**
- Produces: `loginIlink(): Promise<IlinkAccount>` and `ensureIlinkAccount(load, login): Promise<IlinkAccount>`.
- Consumes: QR response fields `qrcode`, `qrcode_img_content`, and status fields `status`, `bot_token`, `ilink_bot_id`, `baseurl`.
- Produces: an account written by Task 1 when QR status is `confirmed`.

- [x] **Step 1: Write the failing no-relogin test**

```ts
test("uses a saved iLink account without logging in", async () => {
  let loggedIn = false;
  const account = { botToken: "token", botId: "bot", baseUrl: "https://ilinkai.weixin.qq.com" };
  assert.equal(await ensureIlinkAccount(async () => account, async () => { loggedIn = true; return account; }), account);
  assert.equal(loggedIn, false);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun test test/bot.test.ts`

Expected: FAIL because `ensureIlinkAccount` does not exist.

- [x] **Step 3: Implement the login path and startup selection**

```ts
export async function ensureIlinkAccount(
  load: () => Promise<IlinkAccount | undefined>,
  login: () => Promise<IlinkAccount>,
): Promise<IlinkAccount> {
  return await load() ?? login();
}
```

Use the demo protocol exactly for `get_bot_qrcode`, `get_qrcode_status`, redirect hosts, optional verify code, expired QR refresh and confirmed result. Print the QR only to the active terminal; save the returned account through `saveIlinkAccount`. Add `qrcode-terminal` and its local declaration. In `main`, pass `loadIlinkAccount` and `loginIlink` to `ensureIlinkAccount`.

- [x] **Step 4: Run focused checks**

Run: `bun test test/bot.test.ts && bun run typecheck`

Expected: PASS.

- [x] **Step 5: Commit QR login**

```bash
git add src/ilink/auth.ts src/ilink/qrcode-terminal.d.ts src/ilink/http.ts src/bot.ts package.json bun.lock README.md test/bot.test.ts
git commit -m "feat: login iLink bot on first run"
```

### Task 3: Verify local-auth startup behavior

**Files:**
- Modify: none

- [x] **Step 1: Run the complete suite**

Run: `bun test && bun run typecheck`

Expected: PASS.

- [ ] **Step 2: Verify existing-account startup**

Run: `bun run bot` with `~/.lkcoffee/account.json` present.

Expected: the long poll starts without a QR prompt.

- [ ] **Step 3: Verify first-run login**

Run: move only `~/.lkcoffee/account.json` aside, then `bun run bot`.

Expected: a terminal QR appears; after scan confirmation an 0600 `account.json` is created and long polling starts.

- [ ] **Step 4: Commit no code**

No commit is needed; Tasks 1 and 2 contain all source changes.

## Self-review

- Spec coverage: Task 1 owns local private persistence; Task 2 owns QR login and no-relogin startup; Task 3 verifies both paths.
- Placeholder scan: no deferred implementation markers appear.
- Type consistency: `loginIlink` returns the `IlinkAccount` that `ensureIlinkAccount` passes to `listenIlink`.
