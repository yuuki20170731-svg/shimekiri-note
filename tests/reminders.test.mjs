import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = (
  await readFile(
    new URL("../supabase/functions/reminders/index.ts", import.meta.url),
    "utf8",
  )
).replace(/^import .*;\r?\n/gm, "");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
function setup(options = {}) {
  const secret = "x".repeat(64);
  const env = {
    REMINDER_WORKER_SECRET: secret,
    SUPABASE_URL: "https://unit.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "test-only",
    APP_ORIGIN: "https://app.invalid",
    BREVO_API_KEY: "test-only",
    BREVO_SENDER_EMAIL: "sender@example.invalid",
    VAPID_PUBLIC_KEY: "test-only",
    VAPID_PRIVATE_KEY: "test-only",
    VAPID_SUBJECT: "mailto:sender@example.invalid",
  };
  if (options.missing) delete env[options.missing];
  const job = {
    id: "job-1",
    deadline_id: "deadline-1",
    owner_id: "owner-1",
    claim_token: "claim-1",
    revision: 1,
    offset_days: 3,
    channel: options.channel ?? "email",
    subscription_id: "subscription-1",
  };
  const rows = {
    reminder_jobs: { status: "processing", claim_token: "claim-1" },
    deadlines: {
      owner_id: "owner-1",
      company: "会社<&>",
      task: "ES提出",
      due_date: "2099-01-01",
      due_time: null,
      status: options.submitted ? "submitted" : "pending",
      revision: options.revision ?? 1,
    },
    notification_settings: { email_enabled: true, push_enabled: true },
    push_subscriptions: {
      owner_id: "owner-1",
      endpoint: options.endpoint ?? "https://fcm.googleapis.com/fcm/send/unit",
      p256dh: "test",
      auth_key: "test",
    },
  };
  const writes = [],
    emails = [],
    pushes = [];
  let claimed = 0;
  let handler;
  const db = {
    rpc: async () => {
      claimed++;
      return { data: [job], error: null };
    },
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user: {
              email: "recipient@example.invalid",
              email_confirmed_at: options.unverified ? null : "2026-01-01",
            },
          },
          error: null,
        }),
      },
    },
    from(table) {
      let update;
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        update(value) {
          update = value;
          return this;
        },
        single: async () => ({
          data: rows[table],
          error: options.readFailure ? { code: "network_failure" } : null,
        }),
        then(resolve) {
          if (update) writes.push({ table, ...update });
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
    },
  };
  const fetch = async (_url, request) => {
    emails.push(JSON.parse(request.body));
    if (options.networkFailure) throw new Error("timeout");
    return new Response(JSON.stringify({ messageId: "message-1" }), {
      status: options.httpStatus ?? 201,
    });
  };
  const webpush = {
    sendNotification: async (...args) => {
      pushes.push(args);
      if (options.pushStatus) throw { statusCode: options.pushStatus };
    },
  };
  vm.runInNewContext(compiled, {
    Deno: {
      env: { get: (key) => env[key] },
      serve: (value) => {
        handler = value;
      },
    },
    createClient: () => db,
    webpush,
    fetch,
    Request,
    Response,
    URL,
    Date,
    AbortSignal,
  });
  return {
    run: (headers = { "x-worker-secret": secret }, method = "POST") =>
      handler(
        new Request("https://unit.invalid/reminders", { method, headers }),
      ),
    writes,
    emails,
    pushes,
    claims: () => claimed,
  };
}
test("秘密がない・違うリクエストは予約も取得しない", async () => {
  const app = setup();
  assert.equal((await app.run({})).status, 401);
  assert.equal(app.claims(), 0);
  assert.equal((await app.run(undefined, "GET")).status, 405);
});
test("配信設定が不完全なら送信せずに停止", async () => {
  const app = setup({ missing: "BREVO_API_KEY" });
  assert.equal((await app.run()).status, 503);
  assert.equal(app.claims(), 0);
});
test("メール受付後に履歴を記録し、HTMLをエスケープする", async () => {
  const app = setup();
  assert.equal((await app.run()).status, 200);
  assert.equal(app.emails.length, 1);
  assert.equal(app.writes[0].status, "sent");
  assert.equal(app.writes[0].provider_id, "message-1");
  assert.ok(app.emails[0].htmlContent.includes("会社&lt;&amp;&gt;"));
  assert.ok(!app.emails[0].textContent.includes("submission_url"));
});
test("提出済み・変更された予約は送信直前に停止", async () => {
  for (const options of [{ submitted: true }, { revision: 2 }]) {
    const app = setup(options);
    await app.run();
    assert.equal(app.emails.length, 0);
    assert.equal(app.writes[0].status, "cancelled");
  }
});
test("未確認のメールアドレスには通知しない", async () => {
  const app = setup({ unverified: true });
  await app.run();
  assert.equal(app.emails.length, 0);
  assert.equal(app.writes[0].status, "skipped");
});
test("レート制限は再試行、送信結果不明は自動再送の対象にしない", async () => {
  const limited = setup({ httpStatus: 429 });
  await limited.run();
  assert.equal(limited.writes[0].status, "failed");
  assert.ok(limited.writes[0].retry_at);
  const timeout = setup({ networkFailure: true });
  await timeout.run();
  assert.equal(timeout.writes[0].status, "unknown");
  assert.equal(timeout.writes[0].retry_at, null);
});
test("送信前のデータ取得失敗は再試行できる", async () => {
  const app = setup({ readFailure: true });
  await app.run();
  assert.equal(app.emails.length, 0);
  assert.equal(app.writes[0].status, "failed");
});
test("プッシュに応募先や本文を含めず、無効な購読を区別", async () => {
  const app = setup({ channel: "push" });
  await app.run();
  assert.equal(app.pushes.length, 1);
  const payload = JSON.parse(app.pushes[0][1]);
  assert.deepEqual(Object.keys(payload).sort(), ["deadlineId", "tag"]);
  const invalid = setup({ channel: "push", pushStatus: 410 });
  await invalid.run();
  assert.equal(invalid.writes[0].status, "skipped");
});
test("偽装されたプッシュの配信先にはリクエストしない", async () => {
  const app = setup({
    channel: "push",
    endpoint: "https://attacker.invalid/push",
  });
  await app.run();
  assert.equal(app.pushes.length, 0);
  assert.equal(app.writes[0].status, "skipped");
});
