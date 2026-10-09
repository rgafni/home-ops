/* Gafni House service worker: caches the app SHELL only (same-origin files listed below).
   Never cached: API calls and data (script.google.com, cross-origin), Google sign-in, and any URL with a
   query string or hash (a personal link ?k=… is never written to the cache; navigations are stored as './'). */
var CACHE = 'homeops-20261009012518';
var SHELL = ['./', 'index.html', 'config.js', 'auth.js', 'manifest.json',
  'fonts/manrope-latin.woff2', 'fonts/manrope-latin-ext.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon.png'];
var SCOPE = self.registration.scope;
var SHELL_URLS = SHELL.map(function (p) { return new URL(p, SCOPE).href; });
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
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                   // API + Google: straight to the network
  var key;
  if (req.mode === 'navigate') key = new URL('./', SCOPE).href;      // the page itself, with any ?k=… dropped
  else if (!url.search && SHELL_URLS.indexOf(url.href) >= 0) key = url.href;
  else return;                                                       // not part of the shell: never cached
  // Network first (updates show up right away); if the network is slow (>2.5s) or offline, answer from the shell cache.
  e.respondWith(caches.open(CACHE).then(function (cache) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic' && !res.redirected) cache.put(key, res.clone());
      return res;
    });
    var slow = new Promise(function (resolve) {
      setTimeout(function () { cache.match(key).then(function (r) { if (r) resolve(r); }); }, 2500);
    });
    return Promise.race([net.catch(function () {
      return cache.match(key).then(function (r) { return r || cache.match(new URL('index.html', SCOPE).href); });
    }), slow]);
  }));
});
