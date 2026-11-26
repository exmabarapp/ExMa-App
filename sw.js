/* Service Worker der ExMa-Bar-App
   - Seite selbst: erst aus dem Netz (damit neue Versionen sofort ankommen), ohne Netz aus dem Speicher
   - Bilder, Icons, Schriften: aus dem Speicher, im Hintergrund aktualisiert
   Bei jeder neuen Version VERSION hochzählen.
   Wichtig: GitHub Pages lässt Dateien 10 Minuten im Browser-Zwischenspeicher. Deshalb wird hier immer
   am Zwischenspeicher vorbei geladen (cache: "reload"/"no-store"/"no-cache"), sonst kommen Updates halb oder gar nicht an.
   Der Speichername enthält den Pfad der App: So stören sich Original und Testversion
   unter derselben Domain nicht gegenseitig. */
const VERSION = "exma-v149";
const SCOPE = self.registration.scope;
const CACHE = VERSION + "|" + SCOPE;
const CORE = [
  "./",
  "./index.html",
  "./logo.png",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./paypal-qr.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      /* nur eigene alte Speicher löschen (gleicher Pfad) und die alten ohne Pfad im Namen */
      .then((keys) => Promise.all(keys
        .filter((k) => k !== CACHE && (k.endsWith("|" + SCOPE) || (k.startsWith("exma-") && !k.includes("|"))))
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req.url, { cache: "no-store", credentials: "same-origin" })
        .then((res) => {
          if (!res.ok) return caches.match("./index.html").then((hit) => hit || res);
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin === self.location.origin || isFont) {
    e.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((hit) => {
          const net = fetch(req, isFont ? undefined : { cache: "no-cache" })
            .then((res) => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; })
            .catch(() => hit);
          return hit || net;
        })
      )
    );
  }
});

/* Benachrichtigungen (Firebase Cloud Messaging, gesendet aus der Firebase-Konsole › Messaging).
   Unter „Benutzerdefinierte Daten“ kann man link = #volltanken o. ä. mitgeben, dann öffnet ein Tippen diese Seite. */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { notification: { body: e.data ? e.data.text() : "" } }; }
  const n = d.notification || {}, x = d.data || {};
  const link = (d.fcmOptions && d.fcmOptions.link) || x.link || "./";
  e.waitUntil(self.registration.showNotification(n.title || x.title || "ExMa Bar", {
    body: n.body || x.body || "", icon: n.icon || "icon-192.png", badge: "icon-192.png", image: n.image || x.image,
    tag: d.fcmMessageId || undefined, data: { link }
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.link) || "./", SCOPE).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const c = list.find((w) => w.url.startsWith(SCOPE));
    if (c) return c.focus().then((f) => (f && f.navigate ? f.navigate(url) : f)).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});

/* Selbsttest aus der App (Ich-Seite): Version melden */
self.addEventListener("message", (e) => {
  if (e.data === "version" && e.ports && e.ports[0]) e.ports[0].postMessage({ version: VERSION, push: true });
});
