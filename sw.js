const CACHE = 'ledger-v4';
const FILES = [
  './life-dashboard.html', './manifest.json', './icon.png',
  './fonts/bricolage-700.woff2', './fonts/bricolage-800.woff2',
  './fonts/plexmono-500-latin.woff2', './fonts/plexmono-500-ext.woff2',
  './fonts/plexmono-600-latin.woff2', './fonts/plexmono-600-ext.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: always try to get the newest version, fall back to the saved
// copy only when offline. This way updates show up on the next open.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
