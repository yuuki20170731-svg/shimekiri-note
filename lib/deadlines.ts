export type DeadlineInput = {
  company: string;
  task: string;
  due_date: string;
  due_time: string | null;
  submission_url: string | null;
  status: "pending" | "submitted";
};
export type Deadline = DeadlineInput & {
  id: string;
  revision: number;
  updated_at: string;
};
export type DateCandidate = {
  label: string;
  date: string | null;
  time: string | null;
};
export type MailCandidates = {
  company: string;
  tasks: string[];
  dates: DateCandidate[];
  links: string[];
  notes: string[];
};

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    Number(value.slice(0, 4)) >= 2000 &&
    Number(value.slice(0, 4)) <= 2100
  );
}
export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function validateDeadline(input: DeadlineInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.company.trim() || input.company.trim().length > 120)
    errors.company = "企業名を1〜120文字で入力してください。";
  if (!input.task.trim() || input.task.trim().length > 240)
    errors.task = "提出するものを1〜240文字で入力してください。";
  if (!validDate(input.due_date))
    errors.due_date = "締切の年月日を確認してください。";
  if (input.due_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.due_time))
    errors.due_time =
      "時刻は00:00〜23:59で入力してください。不明なら空欄にしてください。";
  if (
    input.submission_url &&
    (!safeUrl(input.submission_url) || input.submission_url.length > 2048)
  )
    errors.submission_url = "httpまたはhttpsの提出先URLを入力してください。";
  if (!["pending", "submitted"].includes(input.status))
    errors.status = "提出の状態を確認してください。";
  return errors;
}

export function extractMail(raw: string): MailCandidates {
  if (!raw.trim() || raw.length > 20000)
    throw new Error("メール本文を1〜20,000文字で貼り付けてください。");
  const text = raw
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n");
  const dates: DateCandidate[] = [];
  // ponytail: 日本語の一般的な表記を候補化。対応外の文面は必ず手入力で完了できる。
  const datePattern =
    /(?:(\d{4})[ \t]*(?:年|[./-])[ \t]*)?(\d{1,2})[ \t]*(?:月|[./-])[ \t]*(\d{1,2})[ \t]*日?/g;
  for (const match of text.matchAll(datePattern)) {
    // 年のない小数（10.5など）を日付の候補にしない。
    if (!match[1] && match[0].includes(".")) continue;
    const end = (match.index ?? 0) + match[0].length;
    const nearby = text
      .slice(end, end + 70)
      .split("\n")
      .slice(0, 2)
      .join(" ");
    const nextDate = nearby.search(
      /(?:\d{4}[ \t]*[年./-][ \t]*)?\d{1,2}[ \t]*[月./-][ \t]*\d{1,2}/,
    );
    const timeArea = nextDate >= 0 ? nearby.slice(0, nextDate) : nearby;
    const timeMatch = timeArea.match(
      /(?:^|\D)(午前|午後)?\s*(\d{1,2})\s*(?::|時)\s*(\d{2})\s*分?/,
    );
    const hourOnly = timeMatch
      ? null
      : timeArea.match(/(?:^|\D)(午前|午後)?\s*(\d{1,2})\s*時(?:\D|$)/);
    const foundTime = timeMatch ?? hourOnly;
    let time: string | null = null;
    if (foundTime) {
      const period = foundTime[1];
      let hour = Number(foundTime[2]);
      if (period === "午前" && hour === 12) hour = 0;
      if (period === "午後" && hour < 12) hour += 12;
      time = `${String(hour).padStart(2, "0")}:${timeMatch?.[3] ?? "00"}`;
    }
    const date = match[1]
      ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
      : null;
    const lineStart = text.lastIndexOf("\n", match.index ?? 0) + 1;
    const context = text.slice(lineStart, match.index).trim().slice(-20);
    if (!date || validDate(date))
      dates.push({
        label: `${context ? `${context} ` : ""}${match[0]}${time ? ` ${time}` : ""}${date ? "" : "（年を確認）"}`,
        date,
        time: time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null,
      });
  }
  const links = [
    ...new Set(
      (text.match(/https?:\/\/[^\s<>"'「」]+/g) ?? [])
        .map((url) => url.replace(/[。、，）)>]+$/u, ""))
        .map(safeUrl)
        .filter((url): url is string => !!url),
    ),
  ];
  const companyLine = text
    .split("\n")
    .find(
      (line) =>
        /株式会社|合同会社|有限会社/.test(line) && line.trim().length < 140,
    );
  const company =
    companyLine?.match(
      /(?:株式会社|合同会社|有限会社)\s*[^\s。、:：]+|[^\s。、:：]+\s*(?:株式会社|合同会社|有限会社)/,
    )?.[0] ?? "";
  const tasks = [
    ...new Set(
      (
        text.match(
          /エントリーシート|ポートフォリオ|履歴書|職務経歴書|(?:Web|WEB|ウェブ)?適性検査|Webテスト|オンラインテスト|書類提出|動画提出|面接予約|面談予約|ES(?:提出)?/g,
        ) ?? []
      ).map((task) =>
        /^(ES|エントリーシート)/.test(task)
          ? "エントリーシート提出"
          : task === "ポートフォリオ"
            ? "ポートフォリオ提出"
            : task,
      ),
    ),
  ];
  const notes = [
    "読み取りは候補です。メールの内容と照らし合わせて確認してください。",
  ];
  if (!company) notes.push("企業名を読み取れませんでした。入力してください。");
  if (dates.length !== 1 || !dates[0]?.date)
    notes.push(
      "締切の年月日を選択・入力してください。複数の日付や年のない日付は自動で確定しません。",
    );
  if (/明日|明後日|来週|本日|翌日/.test(text))
    notes.push(
      "相対的な日付が含まれています。実際の年月日を確認してください。",
    );
  if (/24[:時]00/.test(text))
    notes.push(
      "24:00の表記は翌日の00:00を指す可能性があります。日付と時刻を確認してください。",
    );
  return { company, tasks, dates, links, notes };
}

export function jstToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function deadlineInstant(
  item: Pick<DeadlineInput, "due_date" | "due_time">,
): Date {
  return new Date(`${item.due_date}T${item.due_time || "23:59:59"}+09:00`);
}
export function remainingLabel(item: DeadlineInput, now = new Date()): string {
  if (item.status === "submitted") return "提出済み";
  if (deadlineInstant(item).getTime() < now.getTime())
    return "締切を過ぎています";
  const days = Math.round(
    (new Date(`${item.due_date}T00:00:00Z`).getTime() -
      new Date(`${jstToday(now)}T00:00:00Z`).getTime()) /
      86400000,
  );
  return days === 0 ? "今日まで" : days === 1 ? "明日まで" : `あと${days}日`;
}
export function reminderTimes(
  item: DeadlineInput,
  now = new Date(),
): { days: number; at: string }[] {
  if (item.status === "submitted" || !validDate(item.due_date)) return [];
  return [3, 1]
    .map((days) => ({
      days,
      at: new Date(
        `${shiftDate(item.due_date, -days)}T09:00:00+09:00`,
      ).toISOString(),
    }))
    .filter((slot) => new Date(slot.at).getTime() > now.getTime());
}
export function sortDeadlines(items: Deadline[]): Deadline[] {
  return [...items].sort(
    (a, b) =>
      (a.due_date + (a.due_time || "23:59")).localeCompare(
        b.due_date + (b.due_time || "23:59"),
      ) || a.company.localeCompare(b.company, "ja"),
  );
}
export function sampleDeadlines(now = new Date()): Deadline[] {
  return [
    {
      company: "青葉テクノロジー株式会社",
      task: "エントリーシート提出",
      offset: 3,
      time: "23:59",
    },
    {
      company: "株式会社みなとデザイン",
      task: "ポートフォリオ提出",
      offset: 7,
      time: "18:00",
    },
    {
      company: "そらいろシステムズ株式会社",
      task: "Web適性検査",
      offset: 10,
      time: null,
    },
  ].map((sample, i) => ({
    id: `sample-${i}`,
    company: sample.company,
    task: sample.task,
    due_date: shiftDate(jstToday(now), sample.offset),
    due_time: sample.time,
    submission_url: "https://example.com/",
    status: "pending",
    revision: 1,
    updated_at: now.toISOString(),
  }));
}
export function sampleMail(now = new Date()): string {
  const date = shiftDate(jstToday(now), 5);
  return `株式会社みなとデザイン 採用担当です。\n\nポートフォリオをご提出ください。\n提出締切: ${date} 18:00\n提出先: https://example.com/\n\n※使い方の確認用の架空メールです。`;
}
