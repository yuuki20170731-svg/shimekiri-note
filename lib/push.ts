export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function waitForPushStep<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function subscribePush(
  onProgress?: (message: string) => void,
): Promise<PushSubscription> {
  if (!pushSupported())
    throw new Error(
      "このブラウザではプッシュを設定できません。AndroidのChromeなど対応ブラウザで開いてください。",
    );
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error("プッシュ配信の設定が準備中です。");
  onProgress?.("通知の許可を確認しています…");
  const permission = await waitForPushStep(
    Notification.requestPermission(),
    30_000,
    "通知の許可を確認できませんでした。Chromeのサイト設定で通知を許可し、もう一度お試しください。",
  );
  if (permission !== "granted")
    throw new Error(
      "通知が許可されていません。ブラウザのサイト設定から変更できます。",
    );
  onProgress?.("通知の準備をしています…");
  const registration = await waitForPushStep(
    navigator.serviceWorker.register("/sw.js"),
    20_000,
    "通知の準備が完了しませんでした。ページを再読み込みして、もう一度お試しください。",
  );
  await waitForPushStep(
    navigator.serviceWorker.ready,
    20_000,
    "通知の準備が完了しませんでした。ページを再読み込みして、もう一度お試しください。",
  );
  const existing = await waitForPushStep(
    registration.pushManager.getSubscription(),
    20_000,
    "端末の通知設定を確認できませんでした。通信状態を確認して、もう一度お試しください。",
  );
  if (existing) return existing;
  const base64 = key.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(
    atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)),
    (char) => char.charCodeAt(0),
  );
  onProgress?.("この端末を登録しています…");
  return waitForPushStep(
    registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    }),
    30_000,
    "端末の登録が完了しませんでした。Chromeの通知許可と通信状態を確認して、もう一度お試しください。",
  );
}
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await waitForPushStep(
    navigator.serviceWorker.getRegistration("/"),
    10_000,
    "この端末の通知設定を確認できませんでした。ページを再読み込みしてください。",
  );
  return registration
    ? waitForPushStep(
        registration.pushManager.getSubscription(),
        10_000,
        "この端末の通知設定を確認できませんでした。ページを再読み込みしてください。",
      )
    : null;
}
