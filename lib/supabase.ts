import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !url.startsWith("https://")) return null;
  // 公開用キーだけをブラウザへ渡す。管理用キーを誤設定した場合は利用しない。
  let safe = key.startsWith("sb_publishable_");
  if (key.startsWith("eyJ")) {
    try {
      safe = JSON.parse(atob(key.split(".")[1])).role === "anon";
    } catch {
      safe = false;
    }
  }
  if (!safe) return null;
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}
export function appError(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "invalid_credentials")
    return "メールアドレスかパスワードを確認してください。";
  if (code === "email_not_confirmed")
    return "確認メールを開き、メールアドレスを確認してください。";
  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit"
  )
    return "操作が多いため、少し待ってからもう一度お試しください。";
  if (code === "23505")
    return "同じ情報がすでに登録されています。最新の一覧を確認してください。";
  return "処理を完了できませんでした。接続を確認して、もう一度お試しください。入力は残っています。";
}
