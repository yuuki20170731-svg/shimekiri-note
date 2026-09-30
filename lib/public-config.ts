import { Buffer } from "node:buffer";

/** 画面へ埋め込む前に確認する。実行時に拒否するだけでは秘密の混入を防げない。 */
export function publicConfig(values: Record<string, string>) {
  const url = values.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const vapid = values.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const googleClientId = values.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
  if (url) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    ) {
      throw new Error("Supabase URLにはHTTPSの接続先だけを指定してください。");
    }
  }
  if (key) {
    let safe = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
    if (key.startsWith("eyJ")) {
      try {
        safe =
          JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString())
            .role === "anon";
      } catch {
        safe = false;
      }
    }
    if (!safe)
      throw new Error(
        "公開用キーだけを設定してください。管理用・秘密キーは画面へ含められません。",
      );
  }
  if (vapid) {
    const bytes = Buffer.from(vapid, "base64url");
    if (
      !/^[A-Za-z0-9_-]+$/.test(vapid) ||
      bytes.length !== 65 ||
      bytes[0] !== 4
    ) {
      throw new Error(
        "VAPIDには公開キーを設定してください。秘密キーは画面へ含められません。",
      );
    }
  }
  if (
    googleClientId &&
    !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(googleClientId)
  ) {
    throw new Error(
      "Google Client IDにはWebアプリ用の公開IDだけを指定してください。",
    );
  }
  return {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: googleClientId,
  };
}
