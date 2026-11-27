/* Service worker: cache the app shell, network-first for everything else. */
var CACHE = 'tcm-shell-v68';
var CDN = 'https://cdn.jsdelivr.net/npm/';
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/vendor/supabase-2.49.4.js',
  './assets/css/tokens.css',
  './assets/css/app.css',
  './assets/js/config.js',
  './assets/js/units.js',
  './assets/js/db.js',
  './assets/js/logic.js',
  './assets/js/sync.js',
  './assets/js/scanner.js',
  './assets/js/ui.js',
  './assets/js/fx.js',
  './assets/js/fluids.js',
  './assets/js/history.js',
  './assets/js/file.js',
  './assets/js/today.js',
  './assets/js/insights.js',
  './assets/js/notify.js',
  './assets/js/cuff.js',
  './assets/js/snap.js',
  './assets/js/scribe.js',
  './assets/js/phototest.js',
  './assets/js/medcheck.js',
  './assets/js/handoff.js',
  './assets/js/voice.js',
  './assets/js/ask.js',
  './assets/js/capture.js',
  './assets/js/onboarding.js',
  './assets/js/yourdata.js',
  './assets/js/reports.js',
  './assets/js/nav.js',
  './assets/js/simple.js',
  './assets/js/app.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/apple-touch-icon.png',
  './assets/img/welcome.webp',
  './assets/img/empty-diary.webp',
  './assets/img/empty-file.webp',
  './assets/img/empty-kitchen.webp',
  './assets/img/under-care.webp',
  './assets/img/all-done.webp',
  './assets/img/sign-in.webp',
  './assets/img/first-meds.webp',
  './assets/img/visit.webp',
  './assets/img/care-team.webp',
  './assets/img/patterns.webp',
  './assets/img/caught-up.webp',
  './assets/img/read-bottle.webp',
  './assets/img/condense.webp',
  './assets/img/merge.webp',
  './assets/img/correct.webp'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Phone notifications (P-027). The server sends { title, body, url, tag, urgent }, encrypted for this phone.
self.addEventListener('push', function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'The Caregiving Menu', {
    body: d.body || 'Something needs a look.', tag: d.tag || 'tcm', renotify: true, requireInteraction: !!d.urgent,
    icon: './assets/icons/icon-192.png', badge: './assets/icons/icon-192.png', data: { url: d.url || './' }
  }));
});
// Tapping it opens the app on the right screen, reusing an open window when there is one.
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) { list[i].navigate(url); return list[i].focus(); } }
    return self.clients.openWindow(url);
  }));
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
