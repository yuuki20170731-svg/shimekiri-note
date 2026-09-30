import type { MailCandidates } from "./deadlines";

export type JevOption = {
  id: string;
  date: string;
  time: string | null;
  excerpt: string;
};

/** Jevには本文ではなく、画面で確認できる日付候補だけを渡す。 */
export function jevOptions(candidates: MailCandidates): JevOption[] {
  return candidates.dates
    .filter((item) => item.date)
    .slice(0, 8)
    .map((item, index) => ({
      id: `d${index}`,
      date: item.date!,
      time: item.time,
      excerpt: item.label
        .replace(/https?:\/\/\S+/gi, "[URL]")
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[メールアドレス]")
        .replace(/\b(?:\d[ -]?){10,}\b/g, "[番号]")
        .replace(
          /(?:パスワード|password|認証コード|ワンタイムコード|token|secret)\s*[:：=]?\s*\S+/gi,
          "[認証情報]",
        )
        .slice(0, 100),
    }));
}

export function validJevChoice(
  value: unknown,
  options: JevOption[],
): JevOption | null {
  if (!value || typeof value !== "object") return null;
  const answer = value as { choice?: unknown; confidence?: unknown };
  if (
    typeof answer.choice !== "string" ||
    typeof answer.confidence !== "number" ||
    answer.confidence < 0.7
  )
    return null;
  return options.find((item) => item.id === answer.choice) ?? null;
}
