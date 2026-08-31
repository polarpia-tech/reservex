// Phase 14: minimal, hand-written service worker -- no next-pwa/workbox
// dependency (this sandbox has no network access to verify a new npm
// package actually installs/builds against Next.js 14's webpack config,
// so a dependency-free file that's easy to read top to bottom is the
// honest choice here over a plugin that can't be verified end to end).
//
// HONESTY NOTE on what this actually does: ReservX's public pages are
// server-rendered per request against live, ever-changing data (table
// availability, opening hours) -- there is no real "book a table
// offline" feature here, and this file does not pretend there is. What
// it DOES provide, for real:
//   1. Installability -- a service worker + web app manifest (see
//      app/manifest.ts) are what makes Chrome/Edge/Android offer
//      "Install ReservX" at all.
//   2. Faster repeat loads -- static, content-hashed build assets
//      (_next/static/**) are genuinely immutable per deployment, so
//      cache-first for those is always safe and cheap.
//   3. A friendly offline screen (app/offline/page.tsx) instead of the
//      browser's default "no internet" error, when a navigation request
//      fails outright.
//
// Every HTML/data navigation is network-first: the cache is only a
// fallback for when the network request fails completely, never
// preferred over a live response, so a visitor with a connection always
// sees current availability, never a stale cached page.

const CACHE_NAME = 'reservex-shell-v1';
const OFFLINE_URL = '/offline';
const PRECACHE_URLS = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Immutable, content-hashed build output: cache-first, safe forever per deployment.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Page navigations: always prefer a live network response (real availability
  // data) -- the offline page is ONLY a fallback for a fully failed request.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(OFFLINE_URL))),
    );
  }
});
