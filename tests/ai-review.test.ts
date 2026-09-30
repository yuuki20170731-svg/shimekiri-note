import test from "node:test";
import assert from "node:assert/strict";
import { extractMail } from "../lib/deadlines.ts";
import {
  aiReviewOptions,
  needsAiReview,
  validAiReviewChoice,
} from "../lib/ai-review.ts";
import worker from "../public/_worker.js";

test("複数の日付と年なしの日付をAI候補にし、個人情報を伏せる", () => {
  const candidates = extractMail(
    "提出締切：10月5日\n送信日：2026年9月28日\n" +
      "担当 x@y.example password:abc123 2026年10月9日",
  );
  const options = aiReviewOptions(candidates);
  assert.equal(options.length, 3);
  assert.equal(options[0].date, null);
  assert.equal(needsAiReview(candidates), true);
  assert.ok(!JSON.stringify(options).includes("abc123"));
  assert.ok(!JSON.stringify(options).includes("x@y.example"));
  assert.equal(validAiReviewChoice({ choice: "d0" }, options), options[0]);
  assert.equal(validAiReviewChoice({ choice: "outside" }, options), null);
});

test("曖昧でない単一の締切はAI確認を提案しない", () => {
  assert.equal(
    needsAiReview(extractMail("提出締切：2026年10月5日 18:00")),
    false,
  );
});

test("Cloudflare APIは認証を確認し、候補IDだけを返す", async () => {
  const originalFetch = globalThis.fetch;
  let model = "";
  let aiInput: unknown;
  globalThis.fetch = async () => Response.json({ id: "user-1" });
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    AI: {
      run: async (name: string, value: unknown) => {
        model = name;
        aiInput = value;
        return { response: "d0" };
      },
    },
    ASSETS: { fetch: async () => new Response("asset") },
  };
  const request = (authorization?: string) =>
    new Request("https://app.example/api/ai-review", {
      method: "POST",
      headers: {
        Origin: "https://app.example",
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({
        options: [
          { id: "d0", date: null, time: null, excerpt: "提出締切 10月5日" },
          {
            id: "d1",
            date: "2026-09-28",
            time: null,
            excerpt: "送信日 2026年9月28日",
          },
        ],
      }),
    });
  try {
    assert.equal((await worker.fetch(request(), env)).status, 401);
    const response = await worker.fetch(request("Bearer user-token"), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { choice: "d0" });
    assert.equal(model, "@cf/meta/llama-3.1-8b-instruct-fp8");
    assert.match(JSON.stringify(aiInput), /提出締切/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
