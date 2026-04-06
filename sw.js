const CACHE_NAME = 'gomining-v2';

const API_HOSTS = [
  'api.coingecko.com',
  'mempool.space'
];

// Install: skip waiting to activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first for everything (always get latest)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses as fallback for offline
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
