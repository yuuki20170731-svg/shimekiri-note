import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import webpush from "npm:web-push@3.6.7";

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  const expected = Deno.env.get("REMINDER_WORKER_SECRET") ?? "";
  if (
    expected.length < 32 ||
    !sameSecret(request.headers.get("x-worker-secret") ?? "", expected)
  )
    return new Response("Unauthorized", { status: 401 });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const origin = Deno.env.get("APP_ORIGIN");
  const apiKey = Deno.env.get("BREVO_API_KEY");
  const sender = Deno.env.get("BREVO_SENDER_EMAIL");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (
    !url ||
    !serviceKey ||
    !origin?.startsWith("https://") ||
    !apiKey ||
    !sender ||
    !vapidPublic ||
    !vapidPrivate ||
    !vapidSubject
  )
    return new Response("Configuration incomplete", { status: 503 });
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: jobs, error: claimError } = await db.rpc("claim_reminders");
  if (claimError)
    return Response.json({ error: "claim_failed" }, { status: 500 });
  let accepted = 0,
    failed = 0;
  await Promise.all(
    (jobs ?? []).map(async (job) => {
      let state = "unknown",
        errorCode: string | null = null,
        providerId: string | null = null,
        retryAt: string | null = null;
      let deliveryAttempted = false;
      try {
        const [currentResult, deadlineResult, prefsResult] = await Promise.all([
          db
            .from("reminder_jobs")
            .select("status,claim_token")
            .eq("id", job.id)
            .single(),
          db
            .from("deadlines")
            .select("owner_id,company,task,due_date,due_time,status,revision")
            .eq("id", job.deadline_id)
            .single(),
          db
            .from("notification_settings")
            .select("email_enabled,push_enabled")
            .eq("owner_id", job.owner_id)
            .single(),
        ]);
        for (const result of [currentResult, deadlineResult, prefsResult])
          if (result.error && result.error.code !== "PGRST116")
            throw result.error;
        const current = currentResult.data,
          deadline = deadlineResult.data,
          prefs = prefsResult.data;
        if (
          !current ||
          current.status !== "processing" ||
          current.claim_token !== job.claim_token ||
          !deadline ||
          deadline.owner_id !== job.owner_id ||
          deadline.status !== "pending" ||
          deadline.revision !== job.revision ||
          !prefs ||
          (job.channel === "email" ? !prefs.email_enabled : !prefs.push_enabled)
        ) {
          state = "cancelled";
          errorCode = "changed_before_send";
        } else if (
          new Date(
            `${deadline.due_date}T${deadline.due_time ?? "23:59:59"}+09:00`,
          ).getTime() <= Date.now()
        ) {
          state = "skipped";
          errorCode = "deadline_passed";
        } else if (job.channel === "email") {
          const { data: account, error: accountError } =
            await db.auth.admin.getUserById(job.owner_id);
          if (accountError) throw accountError;
          if (!account.user?.email || !account.user.email_confirmed_at) {
            state = "skipped";
            errorCode = "unverified_recipient";
          } else {
            const link = new URL(
              `/?deadline=${encodeURIComponent(job.deadline_id)}`,
              origin,
            ).href;
            const text = `${deadline.company}\n${deadline.task}\n締切: ${deadline.due_date} ${deadline.due_time?.slice(0, 5) ?? "時刻未確認"}（日本時間）\n\n提出内容を確認: ${link}\n通知の停止はアプリの「通知とアカウント」から設定できます。`;
            deliveryAttempted = true;
            const response = await fetch(
              "https://api.brevo.com/v3/smtp/email",
              {
                method: "POST",
                redirect: "error",
                signal: AbortSignal.timeout(15000),
                headers: {
                  "api-key": apiKey,
                  "Content-Type": "application/json",
                  accept: "application/json",
                },
                body: JSON.stringify({
                  sender: { name: "締切ノート", email: sender },
                  to: [{ email: account.user.email }],
                  subject: `【締切ノート】${job.offset_days}日前の締切のお知らせ`,
                  textContent: text,
                  htmlContent: `<p>${escapeHtml(deadline.company)}</p><p>${escapeHtml(deadline.task)}</p><p>締切: ${escapeHtml(deadline.due_date)} ${escapeHtml(deadline.due_time?.slice(0, 5) ?? "時刻未確認")}（日本時間）</p><p><a href="${escapeHtml(link)}">提出内容を確認する</a></p><p>通知の停止はアプリの「通知とアカウント」から設定できます。</p>`,
                }),
              },
            );
            if (response.ok) {
              const result = await response.json().catch(() => ({}));
              providerId =
                typeof result.messageId === "string" ? result.messageId : null;
              state = "sent";
              accepted++;
            } else {
              errorCode = `email_http_${response.status}`;
              state = "failed";
              failed++;
              if (response.status === 429) {
                retryAt = new Date(Date.now() + 5 * 60000).toISOString();
              } else if (response.status >= 500) {
                state = "unknown";
              } else {
                retryAt = new Date(Date.now() + 15 * 60000).toISOString();
              }
            }
          }
        } else {
          const { data: subscription, error: subscriptionError } = await db
            .from("push_subscriptions")
            .select("endpoint,p256dh,auth_key,owner_id")
            .eq("id", job.subscription_id)
            .single();
          if (subscriptionError && subscriptionError.code !== "PGRST116")
            throw subscriptionError;
          if (!subscription || subscription.owner_id !== job.owner_id) {
            state = "cancelled";
            errorCode = "subscription_removed";
          } else {
            const host = new URL(subscription.endpoint).hostname;
            if (
              ![
                "fcm.googleapis.com",
                "updates.push.services.mozilla.com",
                "web.push.apple.com",
              ].includes(host) &&
              !host.endsWith(".notify.windows.com")
            ) {
              state = "skipped";
              errorCode = "unsupported_push_host";
            } else {
              deliveryAttempted = true;
              await webpush.sendNotification(
                {
                  endpoint: subscription.endpoint,
                  keys: {
                    p256dh: subscription.p256dh,
                    auth: subscription.auth_key,
                  },
                },
                JSON.stringify({
                  deadlineId: job.deadline_id,
                  tag: `${job.deadline_id}-${job.revision}-${job.offset_days}`,
                }),
                {
                  vapidDetails: {
                    subject: vapidSubject,
                    publicKey: vapidPublic,
                    privateKey: vapidPrivate,
                  },
                  TTL: 3600,
                  timeout: 15000,
                },
              );
              state = "sent";
              accepted++;
            }
          }
        }
      } catch (error) {
        const status =
          typeof error === "object" && error && "statusCode" in error
            ? Number(error.statusCode)
            : 0;
        errorCode = status ? `push_http_${status}` : "delivery_result_unknown";
        if (!deliveryAttempted) {
          state = "failed";
          errorCode = "preparation_failed";
          retryAt = new Date(Date.now() + 60000).toISOString();
        } else if (status === 404 || status === 410) {
          state = "skipped";
        } else if (status === 429) {
          state = "failed";
          retryAt = new Date(Date.now() + 5 * 60000).toISOString();
        } else {
          state = "unknown";
        }
        failed++;
      }
      // 応答本文や宛先・購読URLをログに残さない。途中で無効化された予約は書き戻さない。
      const { error: settleError } = await db
        .from("reminder_jobs")
        .update({
          status: state,
          last_error: errorCode,
          provider_id: providerId,
          retry_at: retryAt,
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("status", "processing")
        .eq("claim_token", job.claim_token);
      if (settleError) failed++;
    }),
  );
  return Response.json({ processed: jobs?.length ?? 0, accepted, failed });
});
