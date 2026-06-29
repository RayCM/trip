/* 網路優先（network-first）：永遠先抓最新版，連不上時才用快取備援。
   這樣手機加到主畫面能全螢幕開啟，又不會卡在舊版本。 */
const CACHE = 'trip-shell-v1';

self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    fetch(req).then(function (res) {
      try {
        if (new URL(req.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
      } catch (_) {}
      return res;
    }).catch(function () { return caches.match(req); })
  );
});
