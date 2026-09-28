self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "show-os-notify") return;
  const title = event.data.title || "";
  const opts = event.data.opts || {};
  event.waitUntil(self.registration.showNotification(title, opts));
});

/* Clique na bandeja foca a janela e abre a conversa. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientes) => {
      const origem = self.location.origin;
      const url = href ? new URL(href, origem).href : origem + "/app/inbox";
      const alvo = clientes.find((c) => "focus" in c);
      if (alvo) {
        return alvo.focus().then(() => {
          if ("navigate" in alvo) return alvo.navigate(url);
          alvo.postMessage({ type: "notify-open", href: url });
        });
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const clientes = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const visiveis = clientes.filter((c) => c.visibilityState === "visible").length;
      if (visiveis > 0) return;
      let data = { title: "Nova mensagem", body: "", tag: "msg", href: "/app/inbox", icon: "" };
      try {
        if (event.data) data = { ...data, ...event.data.json() };
      } catch {
        // payload não-JSON
      }
      await self.registration.showNotification(data.title, {
        body: data.body,
        tag: data.tag,
        icon: data.icon || undefined,
        badge: self.location.origin + "/icon",
        renotify: true,
        data: { href: data.href || "/app/inbox" },
      });
    })(),
  );
});
