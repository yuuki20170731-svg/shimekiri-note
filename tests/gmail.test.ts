import test from "node:test";
import assert from "node:assert/strict";
import { decodeMimeHeader, mailBody } from "../lib/gmail.ts";

test("Gmailの複数形式メールでは、日本語のテキスト本文を優先して取り出す", () => {
  const encoded = (value: string) => Buffer.from(value).toString("base64url");
  const body = mailBody({
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/html", body: { data: encoded("<p>HTML本文</p>") } },
      {
        mimeType: "text/plain",
        body: { data: encoded("提出期限：2026年10月5日 23:59") },
      },
    ],
  });
  assert.equal(body, "提出期限：2026年10月5日 23:59");
});

test("本文がないメールは候補化せず、添付データを本文扱いしない", () => {
  assert.equal(
    mailBody({
      mimeType: "multipart/mixed",
      parts: [{ mimeType: "application/pdf", body: { data: "AAAA" } }],
    }),
    "",
  );
});

test("Gmail一覧の日本語件名をMIME表記から読める文字に戻す", () => {
  assert.equal(
    decodeMimeHeader(
      "=?UTF-8?B?5o+Q5Ye65pyf6ZmQ?= =?UTF-8?Q?_=E3=81=AE=E3=81=94=E6=A1=88=E5=86=85?=",
    ),
    "提出期限 のご案内",
  );
});
