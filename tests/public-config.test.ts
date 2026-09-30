import test from "node:test";
import assert from "node:assert/strict";
import { publicConfig } from "../lib/public-config.ts";

test("公開ビルドへ管理用キーや通知の秘密鍵を混入させない", () => {
  assert.throws(() =>
    publicConfig({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_unit-test",
    }),
  );
  const jwt = (role: string) =>
    "eyJhbGciOiJub25lIn0." +
    Buffer.from(JSON.stringify({ role })).toString("base64url") +
    ".unit";
  assert.throws(() =>
    publicConfig({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("service_role") }),
  );
  assert.throws(() =>
    publicConfig({
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: Buffer.alloc(32).toString("base64url"),
    }),
  );
  assert.equal(
    publicConfig({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("anon") })
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    jwt("anon"),
  );
  assert.equal(
    publicConfig({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit-test",
    }).NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    "sb_publishable_unit-test",
  );
});
test("保存先URLを確認し、無関係な環境変数は公開しない", () => {
  assert.throws(() =>
    publicConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://username:password@example.invalid/",
    }),
  );
  assert.throws(() =>
    publicConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://example.invalid" }),
  );
  const config = publicConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid",
    BREVO_API_KEY: "unit-secret",
    VAPID_PRIVATE_KEY: "unit-secret",
  });
  assert.deepEqual(
    Object.keys(config).sort(),
    [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
      "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
    ].sort(),
  );
  assert.ok(!JSON.stringify(config).includes("unit-secret"));
});
