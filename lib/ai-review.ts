import type { MailCandidates } from "./deadlines";

export type AiReviewOption = {
  id: string;
  date: string | null;
  time: string | null;
  excerpt: string;
};

/** Send only the short, visible date candidates after the user chooses AI review. */
export function aiReviewOptions(candidates: MailCandidates): AiReviewOption[] {
  return candidates.dates.slice(0, 8).map((item, index) => ({
    id: `d${index}`,
    date: item.date,
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

export function needsAiReview(candidates: MailCandidates): boolean {
  return (
    candidates.dates.length > 1 ||
    candidates.dates.some((item) => !item.date || !item.isDeadline)
  );
}

export function validAiReviewChoice(
  value: unknown,
  options: AiReviewOption[],
): AiReviewOption | null {
  if (!value || typeof value !== "object") return null;
  const choice = (value as { choice?: unknown }).choice;
  if (typeof choice !== "string") return null;
  return options.find((item) => item.id === choice) ?? null;
}
