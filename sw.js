/* Home Ops service worker: offline app shell only. API calls (script.google.com) and
   Google sign-in are cross-origin and are never cached. */
var CACHE = 'homeops-20261009010652';
var SHELL = ['./', 'index.html', 'config.js', 'auth.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Network first (so updates show up right away), but if the network is slow (>2.5s) or offline,
  // answer from the cached shell and let the network copy refresh the cache in the background.
  e.respondWith(caches.open(CACHE).then(function (cache) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    });
    var slow = new Promise(function (resolve) {
      setTimeout(function () {
        cache.match(req).then(function (r) { if (r) resolve(r); });
      }, 2500);
    });
    return Promise.race([net.catch(function () {
      return cache.match(req).then(function (r) { return r || cache.match('index.html'); });
    }), slow]);
  }));
});
