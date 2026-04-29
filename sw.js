// Whispering Forest — service worker
// Pre-caches the HTML, nostr-tools, and same-origin story JSON so a player
// who has loaded the page once online can re-open it offline (flight mode,
// remote travel) and keep playing. WebSocket connections to relays pass
// through and silently fail when offline; the outbox queue in the engine
// buffers events for replay on reconnect.

const CACHE = 'nstadv-cache-v1';

// Cache-on-install: only the truly external dependency. Same-origin files
// (the HTML, story JSON, etc.) are cached lazily on first fetch — that way
// we don't have to know the player's chosen filename (game.html / index.html
// / nostr_text_adventure.html / whatever).
const PRECACHE = [
  './',
  'https://esm.sh/nostr-tools@2.7.2'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Add each URL individually so one failed precache doesn't kill the rest.
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      // Drop old caches
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Only handle GETs; pass through everything else (POST, WebSocket upgrades, etc.)
  if (req.method !== 'GET') return;
  // Skip non-http(s) (chrome-extension, blob, etc.)
  if (!req.url.startsWith('http')) return;

  e.respondWith(
    caches.match(req).then((cached) => {
      // Network-first for HTML so the latest deploy wins when online.
      // Cache-first for everything else (modules, JSON, images, fonts).
      const isHtml = req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html');
      const fromNetwork = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached); // offline → fall back to cache
      return isHtml ? fromNetwork || cached : (cached || fromNetwork);
    })
  );
});
