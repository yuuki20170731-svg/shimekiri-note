export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
export async function subscribePush(): Promise<PushSubscription> {
  if (!pushSupported())
    throw new Error(
      "このブラウザではプッシュを設定できません。AndroidのChromeなど対応ブラウザで開いてください。",
    );
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error("プッシュ配信の設定が準備中です。");
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "通知が許可されていません。ブラウザのサイト設定から変更できます。",
    );
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  const base64 = key.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(
    atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)),
    (char) => char.charCodeAt(0),
  );
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytes,
  });
}
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}
