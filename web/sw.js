/* Offline shell + last-known job data */
const CACHE = 'mtrack-v2';
const SHELL = ['/', '/index.html', '/app.js', '/styles.css', '/fonts/archivo.woff2', '/fonts/chakra-petch-latin-500-normal.woff2', '/fonts/chakra-petch-latin-600-normal.woff2', '/fonts/chakra-petch-latin-700-normal.woff2', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/export')) return;
  // plan images and drawing pages: cache first so sheets you've opened work with no signal
  if (url.pathname.match(/^\/api\/map\/\d+\/image/) || url.pathname.match(/^\/api\/drawings\/\d+\/page\//)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return r; })));
    return;
  }
  // everything else: network first, fall back to the last copy (lets the app open with no signal)
  if (url.pathname === '/api/state' || !url.pathname.startsWith('/api/')) {
    const key = url.pathname.startsWith('/api/') ? req : (url.pathname.includes('.') ? req : '/index.html');
    e.respondWith(fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return r;
    }).catch(() => caches.match(key).then((hit) => hit || Response.error())));
  }
});
