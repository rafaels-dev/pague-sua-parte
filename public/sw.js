// Service worker mínimo: só avisos (push). Sem cache offline.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
	let data = {};
	try {
		data = event.data ? event.data.json() : {};
	} catch {
		data = {};
	}
	const title = typeof data.title === "string" && data.title ? data.title : "PagueSuaParte";
	const body = typeof data.body === "string" ? data.body : "";
	const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/app";
	event.waitUntil(self.registration.showNotification(title, { body, icon: "/icon-192.png", badge: "/icon-192.png", data: { url } }));
});

// Só abre endereços do próprio app; qualquer outro destino cai em /app.
function safeTarget(raw) {
	try {
		const u = new URL(typeof raw === "string" ? raw : "/app", self.location.origin);
		return u.origin === self.location.origin ? u.href : new URL("/app", self.location.origin).href;
	} catch {
		return new URL("/app", self.location.origin).href;
	}
}

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const target = safeTarget(event.notification.data && event.notification.data.url);
	event.waitUntil(
		self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
			for (const client of list) {
				if (new URL(client.url).origin === self.location.origin && "focus" in client) {
					return client
						.focus()
						.then((c) => (c && "navigate" in c ? c.navigate(target) : self.clients.openWindow(target)))
						.catch(() => self.clients.openWindow(target));
				}
			}
			return self.clients.openWindow(target);
		}),
	);
});
