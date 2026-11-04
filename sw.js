/* Service worker: cache the app shell, network-first for everything else. */
var CACHE = 'tcm-shell-v10';
var CDN = 'https://cdn.jsdelivr.net/npm/';
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/config.js',
  './assets/js/units.js',
  './assets/js/db.js',
  './assets/js/logic.js',
  './assets/js/sync.js',
  './assets/js/scanner.js',
  './assets/js/ui.js',
  './assets/js/simple.js',
  './assets/js/app.js',
  './assets/icons/icon.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Android "Share to" lands here as a POST. Park the shared text/photo in a cache the page
// can read, then send the user into the app, which picks it up on load.
var SHARE_CACHE = 'tcm-share';
function handleShare(request) {
  return request.formData().then(function (fd) {
    return caches.open(SHARE_CACHE).then(function (c) {
      var meta = { title: fd.get('title') || '', text: fd.get('text') || '', url: fd.get('url') || '', at: Date.now() };
      var file = fd.get('image');
      var hasFile = file && typeof file !== 'string' && file.size > 0;
      return Promise.all([
        c.put('__share/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } })),
        hasFile ? c.put('__share/image', new Response(file, { headers: { 'Content-Type': file.type || 'image/jpeg' } })) : c.delete('__share/image')
      ]);
    });
  }).then(function () { return Response.redirect('./?share=1', 303); }, function () { return Response.redirect('./', 303); });
}

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShare(e.request));
    return;
  }
  if (e.request.method !== 'GET') return;
  // Pinned, versioned CDN libraries (supabase-js, ZXing) never change: cache-first so they work offline.
  // Both load with crossorigin=anonymous, so these are CORS responses and res.ok is meaningful.
  if (e.request.url.indexOf(CDN) === 0) {
    e.respondWith(caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
        return res;
      });
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});
