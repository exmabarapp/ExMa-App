/* Service Worker der ExMa-Bar-App
   - Seite selbst: erst aus dem Netz (damit neue Versionen sofort ankommen), ohne Netz aus dem Speicher
   - Bilder, Icons, Schriften: aus dem Speicher, im Hintergrund aktualisiert
   Bei jeder neuen Version VERSION hochzählen.
   Der Speichername enthält den Pfad der App: So stören sich Original und Testversion
   unter derselben Domain nicht gegenseitig. */
const VERSION = "exma-v";75
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
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
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
      fetch(req)
        .then((res) => {
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
          const net = fetch(req)
            .then((res) => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; })
            .catch(() => hit);
          return hit || net;
        })
      )
    );
  }
});
