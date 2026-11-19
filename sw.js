/* Glow Show offline shell. Once the app has loaded with signal, a reload with
   none still opens it: the page comes from the network when it answers within
   4 s, else from this cache. Shows, fields and fonts are cached as they load.
   The time Worker (clock, start, cue packs) is never cached: it must be live. */
const CACHE = "glow-show-v1";
const PAGE = "./index.html";

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(["./", PAGE]); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function timeout(ms) { return new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); }); }

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (/workers\.dev$/.test(url.hostname)) return;              // live only
  const sameOrigin = url.origin === self.location.origin;
  const isPage = req.mode === "navigate" || (sameOrigin && /\/(index\.html)?$/.test(url.pathname));
  if (isPage) {
    e.respondWith(Promise.race([fetch(req), timeout(4000)]).then(function (res) {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(PAGE, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(PAGE).then(function (hit) { return hit || caches.match("./"); }).then(function (hit) { return hit || fetch(req); });
    }));
    return;
  }
  const cacheable = (sameOrigin && /\/(shows|fields)\//.test(url.pathname)) || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!cacheable) return;
  // stale-while-revalidate: answer from the cache at once, refresh it behind
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      const net = fetch(req).then(function (res) { if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res; })
        .catch(function () { return hit || Response.error(); });
      return hit || net;
    });
  }));
});
