import test from "node:test";
import assert from "node:assert/strict";
import {
  extractMail,
  validDate,
  validateDeadline,
  safeUrl,
  remainingLabel,
  reminderTimes,
  sampleMail,
  sortDeadlines,
  sampleDeadlines,
  type DeadlineInput,
} from "../lib/deadlines.ts";

const base: DeadlineInput = {
  company: "株式会社テスト",
  task: "ES提出",
  due_date: "2026-10-01",
  due_time: null,
  submission_url: null,
  status: "pending",
};
test("架空メールから会社、締切、提出内容、URLの候補を読み取る", () => {
  const value = extractMail(sampleMail(new Date("2026-09-28T00:00:00Z")));
  assert.equal(value.company, "株式会社みなとデザイン");
  assert.equal(value.dates[0].date, "2026-10-03");
  assert.equal(value.dates[0].time, "18:00");
  assert.equal(value.tasks[0], "ポートフォリオ提出");
  assert.equal(value.links[0], "https://example.com/");
});
test("複数の日付と年なし日付を、推測で確定しない", () => {
  const value = extractMail(
    "説明会 2026年9月30日\n締切 10月1日 23:59\n明日までに確認",
  );
  assert.equal(value.dates.length, 2);
  assert.equal(value.dates[1].date, null);
  assert.equal(value.dates[1].time, "23:59");
  assert.ok(value.notes.some((note) => note.includes("相対")));
});
test("スマホでコピーした案内の点区切り日付と翌行の午後時刻を候補にする", () => {
  const value = extractMail(
    "送信日: 2026.09.28\n提出期限: ２０２６．１０．０５（月）\n午後11時59分まで\n履歴書を提出してください。",
  );
  assert.equal(value.dates.length, 2);
  assert.equal(value.dates[0].time, null);
  assert.equal(value.dates[1].date, "2026-10-05");
  assert.equal(value.dates[1].time, "23:59");
  assert.match(value.dates[1].label, /提出期限/);
  assert.deepEqual(value.tasks, ["履歴書"]);
});
test("不可視文字を含む日付を読み取り、小数は日付にしない", () => {
  const value = extractMail("締切：２０２６年１０\u200b月５日\nスコア 10.5");
  assert.equal(value.dates.length, 1);
  assert.equal(value.dates[0].date, "2026-10-05");
});
test("時刻不明、24:00、実在しない日付を確認対象にする", () => {
  assert.equal(extractMail("締切 2026/10/1").dates[0].time, null);
  const unusual = extractMail("締切 2026年10月1日24:00");
  assert.equal(unusual.dates[0].time, null);
  assert.ok(unusual.notes.some((note) => note.includes("24:00")));
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(extractMail("締切2026/2/30").dates.length, 0);
});
test("危険なリンク・認証情報入りURL・長すぎる本文を拒否する", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("https://user:pass@example.com"), null);
  assert.ok(
    validateDeadline({ ...base, submission_url: "data:text/html,<script>" })
      .submission_url,
  );
  assert.throws(() => extractMail("x".repeat(20001)));
  assert.throws(() => extractMail(" "));
});
test("不足項目を直すまで保存を許さない", () => {
  assert.deepEqual(validateDeadline(base), {});
  const errors = validateDeadline({
    ...base,
    company: " ",
    task: "",
    due_date: "2026-13-01",
    due_time: "24:00",
  });
  assert.deepEqual(Object.keys(errors), [
    "company",
    "task",
    "due_date",
    "due_time",
  ]);
});
test("日本時間の3日前・前日09時を予約し、過去分は含めない", () => {
  assert.deepEqual(reminderTimes(base, new Date("2026-09-27T23:59:59Z")), [
    { days: 3, at: "2026-09-28T00:00:00.000Z" },
    { days: 1, at: "2026-09-30T00:00:00.000Z" },
  ]);
  assert.deepEqual(reminderTimes(base, new Date("2026-09-28T00:00:01Z")), [
    { days: 1, at: "2026-09-30T00:00:00.000Z" },
  ]);
  assert.deepEqual(reminderTimes({ ...base, status: "submitted" }), []);
});
test("年月の境界でも通知日を正しく計算する", () => {
  assert.deepEqual(
    reminderTimes(
      { ...base, due_date: "2027-01-01" },
      new Date("2026-12-27T00:00:00Z"),
    ),
    [
      { days: 3, at: "2026-12-29T00:00:00.000Z" },
      { days: 1, at: "2026-12-31T00:00:00.000Z" },
    ],
  );
});
test("期限当日の既知時刻、時刻未確認、提出済みを区別する", () => {
  const now = new Date("2026-10-01T03:00:00Z");
  assert.equal(remainingLabel(base, now), "今日まで");
  assert.equal(
    remainingLabel({ ...base, due_time: "11:00" }, now),
    "締切を過ぎています",
  );
  assert.equal(
    remainingLabel({ ...base, status: "submitted" }, now),
    "提出済み",
  );
});
test("時刻不明を勝手に確定せず、締切順の表示だけで末尾に並べる", () => {
  const samples = sampleDeadlines(new Date("2026-09-28T00:00:00Z"));
  const ordered = sortDeadlines([...samples].reverse());
  assert.equal(ordered[0].due_date, "2026-10-01");
  assert.equal(ordered[2].due_time, null);
});
