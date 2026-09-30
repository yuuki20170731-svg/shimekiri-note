import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createECDH } from "node:crypto";

test("通知鍵の設定ファイルは読み取れ、既存の鍵を上書きしない", () => {
  const directory = mkdtempSync(join(tmpdir(), "shimekiri-vapid-test-"));
  try {
    const script = fileURLToPath(
      new URL("../scripts/generate-vapid.mjs", import.meta.url),
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    const filename = join(directory, ".env.server.local");
    const content = readFileSync(filename, "utf8");
    const env = Object.fromEntries(
      content
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
    assert.equal(Object.keys(env).length, 3);
    const pair = createECDH("prime256v1");
    pair.setPrivateKey(Buffer.from(env.VAPID_PRIVATE_KEY, "base64url"));
    assert.equal(
      pair.getPublicKey().toString("base64url"),
      env.VAPID_PUBLIC_KEY,
    );
    assert.match(env.REMINDER_WORKER_SECRET, /^[a-f0-9]{64}$/);
    assert.ok(!result.stdout.includes(env.VAPID_PRIVATE_KEY));
    assert.ok(!result.stdout.includes(env.REMINDER_WORKER_SECRET));
    assert.notEqual(
      spawnSync(process.execPath, [script], { cwd: directory }).status,
      0,
    );
    assert.equal(readFileSync(filename, "utf8"), content);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  }
});
