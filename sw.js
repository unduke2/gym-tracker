/* PHUL Tracker — Service Worker
 *
 * Strategy:
 *   • Precache app shell + vendor bundles on install.
 *   • HTML (navigation requests): network-first, fall back to cache. New
 *     deploys propagate on next online refresh; offline loads still work.
 *   • Everything else: cache-first with network fallback. Covers vendor
 *     JS, icon, Google Fonts (CSS + font files).
 *
 * Bump CACHE_VERSION when the precache list changes (e.g. new vendor file).
 * App versions don't need a bump — HTML network-first handles those.
 */
const CACHE_VERSION = "phul-v7.0";
const PRECACHE = [
  "./",
  "./index.html",
  "./icon.svg",
  "./vendor/react.min.js",
  "./vendor/react-dom.min.js",
  "./vendor/babel.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Navigation (HTML) — network-first so new deploys propagate on refresh.
  if (req.mode === "navigate" || (req.destination === "document")) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then(r => r || caches.match("./index.html"))
        )
    );
    return;
  }

  // Everything else — cache-first, backfill on miss.
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        // Only cache successful responses; skip opaque errors.
        if (!res || res.status !== 200) return res;
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      });
    }).catch(() => {
      // Offline and not cached — give up gracefully.
      return new Response("", { status: 504, statusText: "Offline" });
    })
  );
});
