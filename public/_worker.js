const noStore = { "Cache-Control": "no-store" };

function json(body, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

function validOptions(options) {
  return (
    Array.isArray(options) &&
    options.length > 0 &&
    options.length <= 8 &&
    options.every(
      (item, index) =>
        item &&
        item.id === `d${index}` &&
        typeof item.date === "string" &&
        /^20\d{2}-\d{2}-\d{2}$/.test(item.date) &&
        (item.time === null ||
          (typeof item.time === "string" &&
            /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time))) &&
        typeof item.excerpt === "string" &&
        item.excerpt.length <= 100,
    )
  );
}

async function jev(request, env) {
  if (request.method !== "POST")
    return json({ error: "POSTで送信してください。" }, 405);
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return json({ error: "このサイトから操作してください。" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "入力形式を確認してください。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 3000)
    return json({ error: "候補が長すぎます。" }, 413);
  if (!env.AI || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
    return json({ error: "Jevの接続準備中です。" }, 503);

  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return json({ error: "ログインしてください。" }, 401);
  let user;
  try {
    const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!auth.ok) return json({ error: "ログインし直してください。" }, 401);
    user = await auth.json();
  } catch {
    return json({ error: "認証を確認できませんでした。" }, 503);
  }
  if (typeof user?.id !== "string")
    return json({ error: "ログインし直してください。" }, 401);

  let payload;
  try {
    const raw = await request.text();
    if (raw.length > 3000) return json({ error: "候補が長すぎます。" }, 413);
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "候補を読み取れませんでした。" }, 400);
  }
  if (!validOptions(payload?.options))
    return json({ error: "日付候補を確認してください。" }, 400);

  const state = payload.options
    .map(
      (item) =>
        `${item.id}: ${item.date} ${item.time ?? "時刻不明"} / ${item.excerpt}`,
    )
    .join("\n");
  const criteria = Object.fromEntries(
    payload.options.map((item) => [
      item.id,
      `${item.id}に記載された応募・提出の締切`,
    ]),
  );
  criteria.none = "どれも応募・提出の締切ではない、または判断できない";

  try {
    const result = await env.AI.run("typesafe/jev", {
      state,
      questions: {
        deadline: {
          type: "choice",
          instructions:
            "就職活動の案内文から、応募書類や課題の提出締切に最も該当する日付を一つ選んでください。送信日・面接日・説明会開催日は選ばないでください。判断できなければnoneを選んでください。",
          criteria,
        },
      },
    });
    const answer = result?.answers?.deadline;
    if (
      !answer ||
      typeof answer.choice !== "string" ||
      typeof answer.confidence !== "number" ||
      !Object.hasOwn(criteria, answer.choice)
    )
      return json({ error: "Jevの結果を確認できませんでした。" }, 502);
    return json({ choice: answer.choice, confidence: answer.confidence });
  } catch {
    return json(
      { error: "Jevに接続できませんでした。後でもう一度お試しください。" },
      503,
    );
  }
}

const worker = {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api/jev") return jev(request, env);
    if (path.startsWith("/api/"))
      return json({ error: "見つかりません。" }, 404);
    return env.ASSETS.fetch(request);
  },
};

export default worker;
