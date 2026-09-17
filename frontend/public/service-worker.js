// Simple service worker for garçom PWA (#64)
// Cache waiter API and shell for offline

const CACHE_NAME = 'garcom-pwa-v1';
const SHELL = [
  '/',
  '/waiter',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin GET
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // For waiter API, stale-while-revalidate
  if (url.pathname.startsWith('/api/waiter/') || url.pathname.startsWith('/api/kitchen/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        const fetchPromise = fetch(event.request)
          .then((res) => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // For shell, cache-first
  if (SHELL.includes(url.pathname) || url.pathname === '/waiter') {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        return res;
      }))
    );
  }
});
