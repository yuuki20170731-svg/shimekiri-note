import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("PostgreSQLで利用者分離・通知予約・変更・停止・再実行を検証", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,service_role;
      grant execute on function auth.uid() to authenticated,service_role;
      insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
    `);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202609280001_deadlines.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const owner = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    async function login(id) {
      await db.exec(
        `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
      );
    }
    async function admin() {
      await db.exec("reset role;");
    }
    await login(owner);
    await db.query(
      "insert into public.notification_settings(owner_id,email_enabled,push_enabled) values($1,true,false)",
      [owner],
    );
    const {
      rows: [deadline],
    } = await db.query(
      "insert into public.deadlines(company,task,due_date) values('株式会社テスト','ES提出',current_date+10) returning id,revision,due_date",
    );

    await t.test(
      "本人の情報だけ取得し、他人名義の作成・更新・削除を拒否",
      async () => {
        assert.equal(
          (await db.query("select * from public.deadlines")).rows.length,
          1,
        );
        await login(second);
        assert.equal(
          (await db.query("select * from public.deadlines")).rows.length,
          0,
        );
        assert.equal(
          (
            await db.query(
              "update public.deadlines set task='書き換え' where id=$1 returning id",
              [deadline.id],
            )
          ).rows.length,
          0,
        );
        assert.equal(
          (
            await db.query(
              "delete from public.deadlines where id=$1 returning id",
              [deadline.id],
            )
          ).rows.length,
          0,
        );
        await assert.rejects(
          db.query(
            "insert into public.deadlines(owner_id,company,task,due_date) values($1,'偽装','提出',current_date+10)",
            [owner],
          ),
          /row-level security/,
        );
        await assert.rejects(
          db.query("select public.claim_reminders()"),
          /permission denied/,
        );
        await login(owner);
      },
    );
    await t.test("3日前と前日の日本時間09時をサーバーで予約", async () => {
      const { rows } = await db.query(
        "select offset_days,extract(hour from scheduled_at at time zone 'Asia/Tokyo')::int as local_hour from public.reminder_jobs where status='pending' order by offset_days desc",
      );
      assert.equal(rows.length, 2);
      assert.equal(rows[0].offset_days, 3);
      assert.equal(rows[1].offset_days, 1);
      for (const row of rows) assert.equal(row.local_hour, 9);
    });
    await t.test("同じ内容の再実行で通知を重複予約しない", async () => {
      await db.query("update public.deadlines set task=task where id=$1", [
        deadline.id,
      ]);
      assert.equal(
        (
          await db.query(
            "select * from public.reminder_jobs where status='pending'",
          )
        ).rows.length,
        2,
      );
    });
    await t.test("日付変更で古い予定を停止し、新しい予定を作る", async () => {
      await db.query(
        "update public.deadlines set due_date=due_date+1,revision=900 where id=$1",
        [deadline.id],
      );
      const {
        rows: [row],
      } = await db.query("select revision from public.deadlines where id=$1", [
        deadline.id,
      ]);
      assert.equal(row.revision, 2);
      const { rows } = await db.query(
        "select status,revision from public.reminder_jobs",
      );
      assert.equal(rows.filter((row) => row.status === "cancelled").length, 2);
      assert.equal(
        rows.filter((row) => row.status === "pending" && row.revision === 2)
          .length,
        2,
      );
    });
    await t.test("提出済みと通知停止をサーバーでも反映", async () => {
      await db.query(
        "update public.deadlines set status='submitted' where id=$1",
        [deadline.id],
      );
      assert.equal(
        (
          await db.query(
            "select * from public.reminder_jobs where status='pending'",
          )
        ).rows.length,
        0,
      );
      await db.query(
        "update public.deadlines set status='pending' where id=$1",
        [deadline.id],
      );
      assert.equal(
        (
          await db.query(
            "select * from public.reminder_jobs where status='pending'",
          )
        ).rows.length,
        2,
      );
      await db.query(
        "update public.notification_settings set email_enabled=false where owner_id=$1",
        [owner],
      );
      assert.equal(
        (
          await db.query(
            "select * from public.reminder_jobs where status='pending'",
          )
        ).rows.length,
        0,
      );
    });
    await t.test("危険な提出URLと外部の偽装プッシュ配信先を拒否", async () => {
      await assert.rejects(
        db.query(
          "update public.deadlines set submission_url='javascript:alert(1)' where id=$1",
          [deadline.id],
        ),
        /check constraint/,
      );
      await assert.rejects(
        db.query(
          "update public.deadlines set submission_url='https://user:pass@example.com/' where id=$1",
          [deadline.id],
        ),
        /check constraint/,
      );
      await assert.rejects(
        db.query("update public.deadlines set due_time='24:00' where id=$1", [
          deadline.id,
        ]),
        /check constraint/,
      );
      await assert.rejects(
        db.query(
          "insert into public.push_subscriptions(endpoint,p256dh,auth_key) values('https://attacker.invalid/endpoint',$1,$2)",
          ["x".repeat(87), "x".repeat(22)],
        ),
        /check constraint/,
      );
    });
    await t.test(
      "端末登録で有効なメール予約を消さず、端末の分を追加",
      async () => {
        await db.query(
          "update public.notification_settings set email_enabled=true,push_enabled=true where owner_id=$1",
          [owner],
        );
        await db.query(
          "insert into public.push_subscriptions(endpoint,p256dh,auth_key) values('https://fcm.googleapis.com/fcm/send/test-device',$1,$2)",
          ["x".repeat(87), "x".repeat(22)],
        );
        assert.equal(
          (
            await db.query(
              "select * from public.reminder_jobs where status='pending'",
            )
          ).rows.length,
          4,
        );
        await login(second);
        assert.equal(
          (await db.query("select * from public.push_subscriptions")).rows
            .length,
          0,
        );
        assert.equal(
          (await db.query("select * from public.reminder_jobs")).rows.length,
          0,
        );
        await login(owner);
      },
    );
    await t.test("期限を過ぎた登録では過去の通知を作らない", async () => {
      const {
        rows: [row],
      } = await db.query(
        "insert into public.deadlines(company,task,due_date) values('株式会社過去','ES提出',current_date-1) returning id",
      );
      assert.equal(
        (
          await db.query(
            "select * from public.reminder_jobs where deadline_id=$1",
            [row.id],
          )
        ).rows.length,
        0,
      );
    });
    await t.test(
      "同じ予約を二度取得せず、結果不明の送信は自動再送しない",
      async () => {
        await admin();
        await db.query(
          "update public.reminder_jobs set scheduled_at=now()-interval '1 minute' where status='pending'",
        );
        await db.exec("set role service_role");
        const first = await db.query("select * from public.claim_reminders()");
        assert.equal(first.rows.length, 4);
        assert.equal(
          (await db.query("select * from public.claim_reminders()")).rows
            .length,
          0,
        );
        await admin();
        await db.query(
          "update public.reminder_jobs set claimed_at=now()-interval '11 minutes' where status='processing'",
        );
        await db.exec("set role service_role");
        assert.equal(
          (await db.query("select * from public.claim_reminders()")).rows
            .length,
          0,
        );
        await admin();
        assert.equal(
          (
            await db.query(
              "select * from public.reminder_jobs where status='unknown'",
            )
          ).rows.length,
          4,
        );
      },
    );
  } finally {
    await db.close();
  }
});
