self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* 不明な本文でも私的な情報を表示しない。 */
  }
  const id =
    typeof data.deadlineId === "string" && /^[a-z0-9-]+$/.test(data.deadlineId)
      ? data.deadlineId
      : "";
  event.waitUntil(
    self.registration.showNotification("締切ノート", {
      body: "締切が近づいています。提出内容を確認しましょう。",
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      tag:
        typeof data.tag === "string"
          ? data.tag.slice(0, 120)
          : "deadline-reminder",
      data: { url: id ? `/?deadline=${encodeURIComponent(id)}` : "/" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url;
  const url = new URL(
    typeof path === "string" && path.startsWith("/?deadline=") ? path : "/",
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const existing = windows.find(
          (client) => new URL(client.url).origin === self.location.origin,
        );
        if (existing) {
          await existing.navigate(url);
          return existing.focus();
        }
        return self.clients.openWindow(url);
      }),
  );
});
