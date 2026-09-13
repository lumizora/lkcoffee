import assert from "node:assert/strict";
import test from "node:test";
import { formatMessage, openPayment } from "../src/ui.js";

test("keeps model text unchanged inside an unlabeled terminal block", () => {
  assert.equal(
    formatMessage("coffee", "**热门推荐**\n\n| 商品 | 价格 |\n|---|---|\n| 拿铁 | 15元 |", false),
    "────────────────────────────────────────\n**热门推荐**\n\n| 商品 | 价格 |\n|---|---|\n| 拿铁 | 15元 |\n────────────────────────────────────────",
  );
});

test("opens the payment URL with macOS open", () => {
  let command;
  openPayment("https://pay.example/qr", (...args) => { command = args; });
  assert.deepEqual(command, ["open", ["https://pay.example/qr"]]);
});
