/// <reference lib="webworker" />

/**
 * FyzBit service worker.
 *
 * Strategy (spec §14):
 *   - cache-first for hashed static assets (`assets/*`, fonts, icons, manifest)
 *   - network-first with cache fallback for the app shell (`index.html`)
 *   - cross-origin requests (e.g., CDN fetches from in-page debug code) pass through
 *
 * The cache is versioned by build timestamp injected via Vite `define` — bumping
 * triggers a one-time refresh after the next visit.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_VERSION = `${__APP_VERSION__}-${__SW_BUILD_ID__}`;
const CACHE_NAME = `fyzbit-${CACHE_VERSION}`;
const SHELL_URL = './index.html';

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // App shell + obvious essentials. Hashed bundles will be cached on
      // first request via the fetch handler below.
      await cache.addAll([
        SHELL_URL,
        './',
        './manifest.json',
        './icon.svg',
        './icon-192.png',
        './icon-512.png',
        './fonts/Roboto-Regular.ttf',
      ]).catch((err) => {
        console.warn('[sw] precache miss:', err);
      });
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('fyzbit-') && k !== CACHE_NAME).map((k) => caches.delete(k)),
      );
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return; // pass through cross-origin

  // Network-first for the HTML app shell.
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(networkFirstShell(req));
    return;
  }
  // Cache-first for everything else (hashed assets, fonts, icons, json).
  event.respondWith(cacheFirst(req));
});

async function networkFirstShell(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(SHELL_URL, fresh.clone());
    return fresh;
  } catch {
    const cached = (await cache.match(SHELL_URL)) ?? (await cache.match(req));
    if (cached) return cached;
    return new Response('Offline and shell not cached', { status: 503 });
  }
}

async function cacheFirst(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    return new Response(`Offline: ${(err as Error).message}`, { status: 503 });
  }
}
