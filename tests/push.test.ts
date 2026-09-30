import test from "node:test";
import assert from "node:assert/strict";
import { waitForPushStep } from "../lib/push.ts";

test("プッシュ登録の応答が止まっても画面の待機を終える", async () => {
  await assert.rejects(
    waitForPushStep(
      new Promise<never>(() => {}),
      20,
      "登録が完了しませんでした",
    ),
    /登録が完了しませんでした/,
  );
});

test("期限内に完了した登録は結果を返す", async () => {
  assert.equal(
    await waitForPushStep(Promise.resolve("登録済み"), 20, "時間切れ"),
    "登録済み",
  );
});
