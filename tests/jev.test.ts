import test from "node:test";
import assert from "node:assert/strict";
import { extractMail } from "../lib/deadlines.ts";
import { jevOptions, validJevChoice } from "../lib/jev.ts";
import worker from "../public/_worker.js";

test("Jevに渡す候補は8件までで、URL・メールアドレス・認証情報を伏せる", () => {
  const candidates = extractMail(
    "提出期限: 2026年10月5日 18:00\n送信日: 2026年9月28日\n" +
      "A".repeat(20) +
      " password:abc123 2026年10月9日\n" +
      "x@y.example 2026年10月10日\n",
  );
  const options = jevOptions(candidates);
  assert.equal(options.length, 4);
  assert.equal(options[0].date, "2026-10-05");
  assert.ok(!JSON.stringify(options).includes("abc123"));
  assert.ok(!JSON.stringify(options).includes("x@y.example"));
});

test("Jevの不明・低確信度・範囲外IDを採用しない", () => {
  const options = jevOptions(extractMail("締切 2026年10月5日"));
  assert.equal(
    validJevChoice({ choice: "none", confidence: 1 }, options),
    null,
  );
  assert.equal(
    validJevChoice({ choice: "d0", confidence: 0.69 }, options),
    null,
  );
  assert.equal(
    validJevChoice({ choice: "d0", confidence: 0.8 }, options),
    options[0],
  );
});

test("CloudflareのJev APIは未認証を拒否し、認証後は候補だけを判定する", async () => {
  const originalFetch = globalThis.fetch;
  let aiInput: unknown;
  globalThis.fetch = async () => Response.json({ id: "user-1" });
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    AI: {
      run: async (_model: string, value: unknown) => {
        aiInput = value;
        return { answers: { deadline: { choice: "d0", confidence: 0.91 } } };
      },
    },
    ASSETS: { fetch: async () => new Response("asset") },
  };
  const request = (authorization?: string) =>
    new Request("https://app.example/api/jev", {
      method: "POST",
      headers: {
        Origin: "https://app.example",
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({
        options: [
          {
            id: "d0",
            date: "2026-10-05",
            time: "18:00",
            excerpt: "提出期限 2026年10月5日",
          },
        ],
      }),
    });
  try {
    assert.equal((await worker.fetch(request(), env)).status, 401);
    const response = await worker.fetch(request("Bearer user-token"), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { choice: "d0", confidence: 0.91 });
    assert.match(JSON.stringify(aiInput), /提出期限/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
