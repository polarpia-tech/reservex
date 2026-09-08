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
//   4. Phase 6, Part 2c: actually displaying an incoming Web Push message
//      (the 'push' listener below) and handling a tap on it (the
//      'notificationclick' listener below). Everything upstream of this
//      file -- the guest's opt-in in BookingForm.tsx, the subscription
//      stored by join_public_waitlist (0029/0030), and the pg_net trigger
//      + notify-waitlist Edge Function that actually sends the push
//      (0030-0032) -- was already built and, for the send side, verified
//      end to end in production; this file is what makes that push message
//      actually show up as a real OS-level notification.
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

// Phase 6, Part 2c: display an incoming waitlist push notification.
//
// The payload shape (JSON.stringify'd by notify-waitlist, see that Edge
// Function's own source) is currently `{ title, body, slotStartsAt,
// slotEndsAt }` -- no target URL, because notify-waitlist only has the
// restaurant's id, not its public slug, on hand. HONEST GAP, not hidden: a
// tap on the notification below therefore focuses/opens the app at its
// root ('/'), not at the specific restaurant's page. Deep-linking to the
// right restaurant would mean notify-waitlist joining restaurants for its
// slug and including a `url` field -- a real improvement, but a change to
// that already-deployed-and-verified function, deliberately left for a
// separate follow-up rather than folded into this UI-only pass.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Not JSON (or empty) -- nothing sensible to show; don't throw out of
    // the event handler over a malformed push.
    return;
  }

  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'ReservX';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        // Focus an already-open ReservX tab rather than piling up a new one.
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    }),
  );
});
